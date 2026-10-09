/**
 * Repair `calls.called_at` for recordings mis-stamped by the KoreCall PBX clock.
 *
 * ── The defect ──────────────────────────────────────────────────────────────
 * The PBX does not hold its clock across a power cycle. When it is switched off
 * at the end of the day and switched on the next morning, the clock RESUMES from
 * the time it was switched off and ticks forward from there until NTP resyncs it.
 * Every call recorded in that window is therefore filed under the PREVIOUS
 * evening — which is why the dashboard shows calls at 22:00/23:30 on days the
 * office shut at 18:00, and why the following morning looks empty.
 *
 * THIS SCRIPT IS A MITIGATION, NOT A FIX. The device keeps doing it until its
 * RTC battery / NTP-on-boot is sorted out.
 *
 * ── Why R2 LastModified is the ground truth ─────────────────────────────────
 * The FTP upload happens seconds after the call ends, and R2 stamps the object
 * server-side with real UTC. On healthy days `LastModified - called_at` is a
 * rock-steady ~35s. During a drift window it is 14-38h. That gap IS the clock
 * error, so we can recover the true time without guessing.
 *
 * We shift by a per-segment CONSTANT rather than setting each row to its own
 * upload time: within a drift window the clock ticks at the correct rate, so a
 * single offset preserves the exact relative spacing of the calls (and stays
 * right for long calls, whose upload lands well after the call started).
 *
 * Detection reads only the FILENAME and R2's LastModified, never the current DB
 * value, so the script is idempotent — a second run updates zero rows. It also
 * means it cannot collide with the separate legacy +5:30 bug that
 * `fixLegacyOffset.ts` handles (those rows have a healthy ~35s upload delta).
 *
 * ── Usage ───────────────────────────────────────────────────────────────────
 *   node dist/fixClockDrift.js                       # dry run, writes nothing
 *   node dist/fixClockDrift.js --apply               # writes, after a backup
 *   node dist/fixClockDrift.js --revert <backup>     # undo a specific run
 *
 * Unattended (cron) flags:
 *   --since-days N     only consider calls from the last N days   (default 14)
 *   --min-segment N    ignore drift runs shorter than N files     (default 3)
 *   --max-rows N       refuse to run if more than N rows match    (default 5000)
 *   --backup-dir DIR   where to write backups                     (default ./backups)
 *   --keep N           keep only the newest N backups             (default 30)
 *   --quiet            only log when something is actually changed
 *
 * DO NOT run this under `ts-node-dev` from cron — it is a watch-mode dev tool and
 * never exits. Build first (`npm run build`) and run the compiled JS.
 */
import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";
import * as fs from "fs";
import * as path from "path";
import pool from "./db/pool";

// A healthy upload lands ~35s after the call starts; subtract it so the
// corrected time is the call START, not the upload.
const NORMAL_LAG_MS = 35_000;
// Anything beyond this is drift, not network jitter (p99 of healthy days is ~4min).
const DRIFT_THRESHOLD_MS = 60 * 60 * 1000;
// Consecutive uploads whose deltas agree this closely belong to one clock era.
const SEGMENT_TOLERANCE_MS = 5 * 60 * 1000;
// A correction is only believable if it puts the calls back inside opening hours.
const BUSINESS_START_H = 8;
const BUSINESS_END_H = 19;
const MIN_IN_HOURS_RATIO = 0.8;
// Two runs this close in offset belong to the same uncorrected-clock era.
const ERA_TOLERANCE_MS = 30 * 60 * 1000;

const AUDIO_EXT = /\.(wav|webm|mp3)$/i;
const DT_FRAG = /---?-?(20\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{6})-/;

type Rec = { sourceKey: string; nominal: Date; uploadedAt: Date };
type Segment = { offsetMs: number; items: Rec[]; inHours: number };

const arg = (name: string, fallback: number): number => {
  const i = process.argv.indexOf(name);
  if (i === -1) return fallback;
  const v = Number(process.argv[i + 1]);
  return Number.isFinite(v) ? v : fallback;
};
const argStr = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : (process.argv[i + 1] ?? fallback);
};

const istString = (d: Date) =>
  new Date(d.getTime() + 5.5 * 3600e3).toISOString().replace("T", " ").slice(0, 19);
const istHour = (d: Date) => new Date(d.getTime() + 5.5 * 3600e3).getUTCHours();
const inHours = (d: Date) => istHour(d) >= BUSINESS_START_H && istHour(d) < BUSINESS_END_H;

function nominalToDate(ts: string): Date {
  return new Date(
    `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}T` +
    `${ts.slice(8, 10)}:${ts.slice(10, 12)}:${ts.slice(12, 14)}+05:30`
  );
}

/**
 * List recordings uploaded within the window. R2 cannot filter a LIST by date,
 * but the PBX files objects under `korecall/YYYYMM/`, so we only walk the month
 * prefixes the window can touch instead of the whole 42k-object bucket.
 */
async function listRecordings(s3: S3Client, sinceDays: number): Promise<Rec[]> {
  const cutoff = new Date(Date.now() - sinceDays * 86400e3);
  const recompressGuard = new Date(+cutoff - 2 * 86400e3);
  const prefixes = new Set<string>();
  for (let d = new Date(cutoff); d <= new Date(); d = new Date(+d + 15 * 86400e3)) {
    prefixes.add(`korecall/${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}/`);
  }
  const now = new Date();
  prefixes.add(`korecall/${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}/`);

  const out: Rec[] = [];
  for (const Prefix of prefixes) {
    let token: string | undefined;
    do {
      const page = await s3.send(new ListObjectsV2Command({
        Bucket: process.env.R2_BUCKET, Prefix, ContinuationToken: token, MaxKeys: 1000,
      }));
      for (const o of page.Contents ?? []) {
        // The FTP service stores compressed .webm/.mp3 (or .wav on fallback)
        if (!o.Key || !o.LastModified || !AUDIO_EXT.test(o.Key)) continue;
        if (o.LastModified < cutoff) continue;
        const m = o.Key.split("/").pop()!.match(DT_FRAG);
        if (!m) continue;
        const nominal = nominalToDate(m[1]);
        // A call stamped well before the window but uploaded inside it was
        // re-uploaded later (recompress.ts), not mis-clocked — real drift is
        // at most ~38h. Without this, re-compressed files look like drift.
        if (nominal < recompressGuard) continue;
        out.push({
          // `source_file_key` in the DB is the original .wav path WITHOUT the
          // `korecall/` prefix, whatever format was actually stored.
          sourceKey: o.Key.replace(/^korecall\//, "").replace(AUDIO_EXT, ".wav"),
          nominal,
          uploadedAt: o.LastModified,
        });
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
  }
  return out;
}

/** Group drifted uploads into contiguous runs that share one clock offset. */
function findDriftSegments(recs: Rec[], minSegment: number): { kept: Segment[]; rejected: Segment[] } {
  const byUpload = [...recs].sort((a, b) => +a.uploadedAt - +b.uploadedAt);
  const raw: Array<{ ref: number; items: Rec[] }> = [];
  let current: { ref: number; items: Rec[] } | null = null;

  for (const r of byUpload) {
    const delta = +r.uploadedAt - +r.nominal;
    if (delta <= DRIFT_THRESHOLD_MS) { current = null; continue; }
    if (current && Math.abs(delta - current.ref) < SEGMENT_TOLERANCE_MS) {
      current.items.push(r);
      current.ref = delta;
    } else {
      current = { ref: delta, items: [r] };
      raw.push(current);
    }
  }

  const all: Segment[] = raw.map(s => {
    const deltas = s.items.map(r => +r.uploadedAt - +r.nominal).sort((a, b) => a - b);
    const offsetMs = deltas[Math.floor(deltas.length / 2)] - NORMAL_LAG_MS;
    return {
      offsetMs,
      items: s.items,
      inHours: s.items.filter(r => inHours(new Date(+r.nominal + offsetMs))).length,
    };
  });

  // Guard against "correcting" a one-off late retry into nonsense: the shift must
  // put the calls back inside opening hours, AND the run must be big enough to be
  // a real outage.
  const believable = (s: Segment) => s.inHours / s.items.length >= MIN_IN_HOURS_RATIO;
  const kept = all.filter(s => s.items.length >= minSegment && believable(s));

  // A short run is still trustworthy if it shares a clock era with a run we
  // already accepted — the PBX drifts by one offset until NTP resyncs, so a lone
  // file 5 minutes off a confirmed offset is the same outage, not a coincidence.
  // Compare against a snapshot so promotions cannot chain off other promotions.
  const confirmedEras = kept.map(k => k.offsetMs);
  const rejected: Segment[] = [];
  for (const s of all) {
    if (kept.includes(s)) continue;
    const sameEra = believable(s) &&
      confirmedEras.some(o => Math.abs(o - s.offsetMs) <= ERA_TOLERANCE_MS);
    (sameEra ? kept : rejected).push(s);
  }
  kept.sort((a, b) => +a.items[0].uploadedAt - +b.items[0].uploadedAt);
  return { kept, rejected };
}

function pruneBackups(dir: string, keep: number) {
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir)
    .filter(f => f.startsWith("clock-drift-backup-") && f.endsWith(".json"))
    .sort().reverse();
  for (const f of files.slice(keep)) fs.unlinkSync(path.join(dir, f));
}

async function main() {
  const apply = process.argv.includes("--apply");
  const quiet = process.argv.includes("--quiet");
  const sinceDays = arg("--since-days", 14);
  const minSegment = arg("--min-segment", 3);
  const maxRows = arg("--max-rows", 5000);
  const backupDir = argStr("--backup-dir", "./backups");
  const keep = arg("--keep", 30);
  const log = (...a: unknown[]) => { if (!quiet) console.log(...a); };

  if (process.argv.includes("--revert")) {
    const file = process.argv[process.argv.indexOf("--revert") + 1];
    const backup: Array<{ source_file_key: string; called_at: string }> =
      JSON.parse(fs.readFileSync(file, "utf8"));
    let n = 0;
    for (const b of backup) {
      const r = await pool.query(
        "UPDATE calls SET called_at = $1 WHERE source_file_key = $2",
        [b.called_at, b.source_file_key]
      );
      n += r.rowCount ?? 0;
    }
    console.log(`Reverted ${n} rows from ${file}`);
    await pool.end();
    return;
  }

  const s3 = new S3Client({
    region: "auto",
    endpoint: process.env.R2_ENDPOINT,
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });

  log(`Scanning recordings uploaded in the last ${sinceDays} days…`);
  const recs = await listRecordings(s3, sinceDays);
  log(`  ${recs.length} recordings in window`);

  const { kept, rejected } = findDriftSegments(recs, minSegment);
  const affected = kept.reduce((n, s) => n + s.items.length, 0);

  // Informational, not actionable — a stuck singleton would otherwise re-warn on
  // every hourly tick. Surfaced in the report instead when a run actually writes.
  for (const s of rejected) {
    if (quiet) break;
    console.warn(
      `SKIPPED segment: ${s.items.length} file(s), offset ${(s.offsetMs / 3600e3).toFixed(2)}h, ` +
      `${s.inHours}/${s.items.length} would land in hours — first ${s.items[0].sourceKey}`
    );
  }

  if (!affected) {
    log("No clock drift detected. Nothing to do.");
    await pool.end();
    return;
  }

  const totalInHours = kept.reduce((n, s) => n + s.inHours, 0);
  // Held back until we know something will actually be written, so an hourly
  // cron logs nothing on the (normal) runs where every row is already correct.
  const report = () => {
    console.log(`\nClock-drift segments (stamped → corrected, IST):\n`);
    for (const s of kept) {
      const a = s.items[0], b = s.items[s.items.length - 1];
      console.log(
        `  ${String(s.items.length).padStart(4)} calls  ` +
        `${(s.offsetMs / 3600e3).toFixed(2).padStart(6)}h   ` +
        `${istString(a.nominal)} → ${istString(b.nominal)}   ==>   ` +
        `${istString(new Date(+a.nominal + s.offsetMs))} → ${istString(new Date(+b.nominal + s.offsetMs))}`
      );
    }
    console.log(
      `\n${affected} calls across ${kept.length} segments.\n` +
      `Sanity check: ${totalInHours}/${affected} ` +
      `(${(100 * totalInHours / affected).toFixed(2)}%) land inside ` +
      `${BUSINESS_START_H}:00–${BUSINESS_END_H}:00 IST after correction.` +
      (rejected.length
        ? `\n${rejected.length} segment(s) left alone as unverifiable ` +
          `(${rejected.reduce((n, s) => n + s.items.length, 0)} file(s)).`
        : "") + "\n"
    );
  };
  if (!quiet) report();

  if (affected > maxRows) {
    console.error(
      `ABORT: ${affected} rows exceeds --max-rows ${maxRows}. This is far more than a ` +
      `normal overnight outage — check the PBX before letting the job rewrite this much.`
    );
    await pool.end();
    process.exitCode = 2;
    return;
  }

  if (!apply) {
    console.log("Dry run — nothing written. Re-run with --apply to commit.");
    await pool.end();
    return;
  }

  const targets = kept.flatMap(s =>
    s.items.map(r => ({ sourceKey: r.sourceKey, corrected: new Date(+r.nominal + s.offsetMs) }))
  );

  const existing = await pool.query(
    `SELECT source_file_key, called_at FROM calls WHERE source_file_key = ANY($1)`,
    [targets.map(t => t.sourceKey)]
  );
  // Nothing to write if every row already holds its corrected value (idempotent re-run).
  const current = new Map(existing.rows.map((r: any) => [r.source_file_key, +r.called_at]));
  const pending = targets.filter(t => current.get(t.sourceKey) !== +t.corrected);
  if (!pending.length) {
    log("All matching rows are already correct. Nothing to write.");
    await pool.end();
    return;
  }

  // Something really is being rewritten — now the detail is worth a log line.
  if (quiet) {
    console.log(`\n${new Date().toISOString()} clock drift detected`);
    report();
  }

  fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, `clock-drift-backup-${Date.now()}.json`);
  fs.writeFileSync(backupPath, JSON.stringify(
    existing.rows.filter((r: any) => pending.some(p => p.sourceKey === r.source_file_key))));
  console.log(`Backed up ${pending.length} rows → ${backupPath}`);

  const client = await pool.connect();
  let updated = 0;
  try {
    await client.query("BEGIN");
    for (const t of pending) {
      const r = await client.query(
        "UPDATE calls SET called_at = $1 WHERE source_file_key = $2 AND called_at IS DISTINCT FROM $1",
        [t.corrected.toISOString(), t.sourceKey]
      );
      updated += r.rowCount ?? 0;
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }

  pruneBackups(backupDir, keep);
  console.log(`Updated ${updated} rows. Revert with:\n  node dist/fixClockDrift.js --revert ${backupPath}`);
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
