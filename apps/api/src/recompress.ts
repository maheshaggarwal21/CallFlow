/**
 * Re-compress recordings that were stored in R2 as WAV before the FTP service
 * started compressing uploads (2026-10-09). Each WAV becomes the format chosen
 * on the Settings page (system_state.audio_format), ~25-28% of its size.
 *
 * ── Per call, in this order (so a crash can never lose audio) ────────────────
 *   1. download the WAV, encode it, and check the result is as long as the
 *      original (±2s) — the same guard the FTP service uses
 *   2. upload the compressed object next to it (same name, new extension)
 *   3. point `calls.audio_storage_key` at it — only if the row still holds the
 *      WAV key; otherwise the new object is removed and the call skipped
 *   4. delete the WAV
 * A crash between 3 and 4 leaves an orphan WAV that retention.ts removes once
 * it ages out. Re-running is safe: only rows still pointing at a .wav qualify.
 *
 * ── Why --min-age-days ───────────────────────────────────────────────────────
 * Re-uploading resets the object's R2 LastModified, which fixClockDrift.ts uses
 * to detect PBX clock drift. That script ignores objects whose call date is
 * more than (its 14-day window + 2 days) old, so only re-compress calls older
 * than that — 16 days by default. Don't lower it.
 *
 * ── Usage ───────────────────────────────────────────────────────────────────
 *   node dist/recompress.js                     # dry run: counts only
 *   node dist/recompress.js --apply             # converts
 *
 *   --limit N          at most N calls this run              (default: all)
 *   --min-age-days N   only calls older than N days          (default 16, min 16)
 *   --concurrency N    parallel conversions                  (default 2)
 *   --quiet            only log when something was converted
 *
 * Build first (`npm run build`) and run the compiled JS.
 */
import { readFileSync, statSync, unlinkSync, existsSync } from "fs";
import pool from "./db/pool";
import { downloadAudioToFile, uploadAudioObject, deleteAudioObject } from "./services/storage.service";
import { encodeFile, probeDuration, PLAY_FORMATS, type PlayFormat } from "./services/transcode.service";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const APPLY = process.argv.includes("--apply");
const QUIET = process.argv.includes("--quiet");
const LIMIT = arg("--limit") ? Number(arg("--limit")) : null;
const MIN_AGE_DAYS = Number(arg("--min-age-days") ?? 16);
const CONCURRENCY = Number(arg("--concurrency") ?? 2);
const DURATION_TOLERANCE_S = 2;

function log(msg: string) {
  console.log(`${new Date().toISOString()} [recompress] ${msg}`);
}

type Row = { id: string; audio_storage_key: string };
type Result = { ok: boolean; before: number; after: number; reason?: string };

const remove = (p: string | null) => {
  if (p && existsSync(p)) {
    try { unlinkSync(p); } catch { /* ignore */ }
  }
};

async function convert(row: Row, format: PlayFormat): Promise<Result> {
  const oldKey = row.audio_storage_key;
  const newKey = oldKey.replace(/\.wav$/i, PLAY_FORMATS[format].ext);
  let wav: string | null = null;
  let out: string | null = null;
  try {
    wav = await downloadAudioToFile(oldKey);
    if (!wav) return { ok: false, before: 0, after: 0, reason: "download failed" };
    out = wav.replace(/\.wav$/i, "") + PLAY_FORMATS[format].ext;
    const before = statSync(wav).size;

    await encodeFile(wav, out, format);
    const [inDur, outDur] = await Promise.all([probeDuration(wav), probeDuration(out)]);
    if (outDur <= 0 || Math.abs(outDur - inDur) > DURATION_TOLERANCE_S) {
      return { ok: false, before, after: 0, reason: `duration ${inDur}s -> ${outDur}s` };
    }
    const after = statSync(out).size;

    if (!(await uploadAudioObject(newKey, readFileSync(out), PLAY_FORMATS[format].contentType))) {
      return { ok: false, before, after, reason: "upload failed" };
    }
    const upd = await pool.query(
      "UPDATE calls SET audio_storage_key = $1 WHERE id = $2 AND audio_storage_key = $3",
      [newKey, row.id, oldKey]
    );
    if (upd.rowCount !== 1) {
      // Another run (e.g. the nightly cron) may have converted this call first
      // and now points at the very key we just uploaded — only clean up our
      // object if nothing references it.
      const cur = await pool.query("SELECT 1 FROM calls WHERE audio_storage_key = $1 LIMIT 1", [newKey]);
      if (cur.rowCount === 0) await deleteAudioObject(newKey);
      return { ok: false, before, after, reason: "row changed underneath us" };
    }
    const stillUsed = await pool.query("SELECT 1 FROM calls WHERE audio_storage_key = $1 LIMIT 1", [oldKey]);
    if (stillUsed.rowCount) {
      log(`WARN ${oldKey} is still referenced by another call; leaving it in place`);
    } else if (!(await deleteAudioObject(oldKey))) {
      log(`WARN converted ${row.id} but could not delete ${oldKey} (orphan; retention will remove it)`);
    }
    return { ok: true, before, after };
  } catch (err) {
    return { ok: false, before: 0, after: 0, reason: (err as Error).message.slice(0, 200) };
  } finally {
    remove(wav);
    remove(out);
  }
}

async function main() {
  if (!Number.isFinite(MIN_AGE_DAYS) || MIN_AGE_DAYS < 16) {
    throw new Error(`--min-age-days must be >= 16 (fixClockDrift window + 2 days); got ${MIN_AGE_DAYS}`);
  }
  if (!Number.isInteger(CONCURRENCY) || CONCURRENCY < 1 || CONCURRENCY > 16) {
    throw new Error("--concurrency must be 1..16");
  }

  const fmtRes = await pool.query("SELECT audio_format FROM system_state WHERE id = 1");
  const format: PlayFormat = fmtRes.rows[0]?.audio_format === "mp3" ? "mp3" : "opus";

  const rows: Row[] = (
    await pool.query(
      "SELECT id, audio_storage_key FROM calls " +
        "WHERE audio_storage_key LIKE 'korecall/%.wav' AND called_at < now() - make_interval(days => $1) " +
        "ORDER BY called_at" + (LIMIT ? ` LIMIT ${Math.floor(LIMIT)}` : ""),
      [MIN_AGE_DAYS]
    )
  ).rows;

  if (rows.length === 0) {
    if (!QUIET) log(`nothing to do — no WAV recordings older than ${MIN_AGE_DAYS} days`);
    return;
  }
  if (!APPLY) {
    log(`DRY RUN — ${rows.length} WAV recordings older than ${MIN_AGE_DAYS} days would become ${format}`);
    return;
  }

  log(`converting ${rows.length} recordings to ${format} (concurrency ${CONCURRENCY})`);
  let done = 0, failed = 0, before = 0, after = 0, next = 0;
  const reasons = new Map<string, number>();
  const started = Date.now();

  async function worker() {
    while (next < rows.length) {
      const row = rows[next++];
      const r = await convert(row, format);
      if (r.ok) {
        done++;
        before += r.before;
        after += r.after;
      } else {
        failed++;
        reasons.set(r.reason ?? "?", (reasons.get(r.reason ?? "?") ?? 0) + 1);
      }
      const n = done + failed;
      if (n % 500 === 0) {
        const rate = n / ((Date.now() - started) / 1000);
        log(`${n}/${rows.length} (${failed} failed) · ${(before / 1e9).toFixed(2)} GB -> ${(after / 1e9).toFixed(2)} GB · ${rate.toFixed(1)}/s`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  log(
    `converted ${done}/${rows.length}, ${failed} failed · ` +
      `${(before / 1e9).toFixed(2)} GB -> ${(after / 1e9).toFixed(2)} GB ` +
      `(saved ${((before - after) / 1e9).toFixed(2)} GB) in ${Math.round((Date.now() - started) / 1000)}s` +
      (reasons.size ? ` · failures: ${[...reasons].map(([k, v]) => `${k} ×${v}`).join("; ")}` : "")
  );
  if (failed) process.exitCode = 1;
}

main()
  .catch((err) => {
    log(`FAILED: ${(err as Error).message}`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
