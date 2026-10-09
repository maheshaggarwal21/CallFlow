/**
 * Rolling retention window for call recordings in R2.
 *
 * The client keeps only the last N days (default 90) of audio so the bucket stays
 * inside Cloudflare's free tier. Older recordings are deleted from R2 and their
 * `calls.audio_storage_key` is cleared — the call row itself (phone, agent,
 * duration, analytics) is kept forever; the dashboard just shows "no audio".
 *
 * ── What gets deleted ───────────────────────────────────────────────────────
 *   1. Objects referenced by calls whose `called_at` is older than the cutoff.
 *   2. Unreferenced objects under `korecall/YYYYMM/YYYYMMDD/` whose folder date
 *      is older than the cutoff (failed inserts, test uploads, etc.).
 * An object still referenced by a call INSIDE the window is never deleted, even
 * if its folder date is old — fixClockDrift.ts corrects `called_at` but leaves
 * the R2 path at the PBX's wrong date, so folder date alone isn't trusted.
 * Only keys under `korecall/` are ever touched.
 *
 * ── Usage ───────────────────────────────────────────────────────────────────
 *   node dist/retention.js              # dry run: reports, deletes nothing
 *   node dist/retention.js --apply      # deletes
 *
 *   --days N         keep the last N days                         (default 90, min 30)
 *   --max-delete N   refuse to run if more than N objects match   (default 3000)
 *   --quiet          only log when something is actually deleted
 *
 * A normal night deletes one day's calls (~1,000). The cap stops a bad clock,
 * bad flag or bad DB state from wiping the bucket; raise it deliberately for a
 * catch-up run.
 *
 * DO NOT run this under `ts-node-dev` from cron — it never exits. Build first
 * (`npm run build`) and run the compiled JS.
 */
import {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectsCommand,
  type _Object,
} from "@aws-sdk/client-s3";
import pool from "./db/pool";

const PREFIX = "korecall/";
const DATED_KEY = /^korecall\/\d{6}\/(\d{8})\//;
const IST_OFFSET_MS = 330 * 60 * 1000;
const BATCH = 1000; // DeleteObjects limit

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const APPLY = process.argv.includes("--apply");
const QUIET = process.argv.includes("--quiet");
const DAYS = Number(arg("--days") ?? process.env.RETENTION_DAYS ?? 90);
const MAX_DELETE = Number(arg("--max-delete") ?? 3000);

function log(msg: string) {
  console.log(`${new Date().toISOString()} [retention] ${msg}`);
}

/** YYYYMMDD of `d` in IST — the PBX names folders in local time. */
function istDay(d: Date): string {
  return new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10).replace(/-/g, "");
}

async function listAll(s3: S3Client, bucket: string): Promise<_Object[]> {
  const out: _Object[] = [];
  let token: string | undefined;
  do {
    const page = await s3.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: PREFIX, ContinuationToken: token })
    );
    out.push(...(page.Contents ?? []));
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return out;
}

async function main() {
  if (!Number.isFinite(DAYS) || DAYS < 30) throw new Error(`--days must be >= 30 (got ${DAYS})`);
  if (!Number.isFinite(MAX_DELETE) || MAX_DELETE < 1) throw new Error(`invalid --max-delete`);

  const bucket = process.env.R2_BUCKET;
  if (!process.env.R2_ENDPOINT || !bucket) throw new Error("R2_ENDPOINT / R2_BUCKET not set");

  const s3 = new S3Client({
    region: "auto",
    endpoint: process.env.R2_ENDPOINT,
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });

  const cutoff = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000);
  const cutoffDay = istDay(cutoff);

  const [objects, oldRes, keepRes] = await Promise.all([
    listAll(s3, bucket),
    pool.query(
      "SELECT audio_storage_key FROM calls WHERE called_at < $1 AND audio_storage_key LIKE 'korecall/%'",
      [cutoff.toISOString()]
    ),
    pool.query(
      "SELECT audio_storage_key FROM calls WHERE called_at >= $1 AND audio_storage_key LIKE 'korecall/%'",
      [cutoff.toISOString()]
    ),
  ]);

  const sizeOf = new Map(objects.map((o) => [o.Key!, o.Size ?? 0]));
  const protectedKeys = new Set<string>(keepRes.rows.map((r) => r.audio_storage_key));
  const oldRowKeys = new Set<string>(oldRes.rows.map((r) => r.audio_storage_key));

  const toDelete = new Set<string>();
  for (const key of oldRowKeys) if (sizeOf.has(key)) toDelete.add(key);
  for (const o of objects) {
    const m = DATED_KEY.exec(o.Key!);
    if (m && m[1] < cutoffDay) toDelete.add(o.Key!);
  }
  for (const key of protectedKeys) toDelete.delete(key);

  // Old rows pointing at an object that is already gone: clear the dead link too
  const dangling = [...oldRowKeys].filter((k) => !sizeOf.has(k) && !protectedKeys.has(k));

  const keys = [...toDelete].sort();
  const bytes = keys.reduce((n, k) => n + (sizeOf.get(k) ?? 0), 0);
  const bucketBytes = objects.reduce((n, o) => n + (o.Size ?? 0), 0);
  const gb = (b: number) => (b / 1e9).toFixed(2);

  const summary =
    `keep ${DAYS}d (before ${cutoffDay} IST): ${keys.length} objects / ${gb(bytes)} GB to delete, ` +
    `${dangling.length} dangling links; bucket ${objects.length} objects / ${gb(bucketBytes)} GB`;

  if (keys.length === 0 && dangling.length === 0) {
    if (!QUIET) log(`nothing to do — ${summary}`);
    return;
  }
  if (keys.length > MAX_DELETE) {
    throw new Error(`refusing: ${keys.length} objects exceed --max-delete ${MAX_DELETE}. ${summary}`);
  }
  if (!APPLY) {
    log(`DRY RUN — ${summary}`);
    if (keys.length) log(`oldest: ${keys[0]}  newest: ${keys[keys.length - 1]}`);
    return;
  }

  let deleted = 0;
  let cleared = 0;
  const errors: string[] = [];
  for (let i = 0; i < keys.length; i += BATCH) {
    const batch = keys.slice(i, i + BATCH);
    const res = await s3.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: false },
      })
    );
    const done = (res.Deleted ?? []).map((d) => d.Key!).filter(Boolean);
    for (const e of res.Errors ?? []) errors.push(`${e.Key}: ${e.Code}`);
    deleted += done.length;
    // Clear links only for objects R2 confirmed gone, batch by batch, so a
    // crash mid-run never leaves rows pointing at deleted audio.
    if (done.length) {
      const upd = await pool.query(
        "UPDATE calls SET audio_storage_key = NULL WHERE audio_storage_key = ANY($1)",
        [done]
      );
      cleared += upd.rowCount ?? 0;
    }
  }
  if (dangling.length) {
    const upd = await pool.query(
      "UPDATE calls SET audio_storage_key = NULL WHERE audio_storage_key = ANY($1) AND called_at < $2",
      [dangling, cutoff.toISOString()]
    );
    cleared += upd.rowCount ?? 0;
  }

  log(
    `deleted ${deleted}/${keys.length} objects (${gb(bytes)} GB), cleared ${cleared} call links` +
      (errors.length ? `, ${errors.length} ERRORS e.g. ${errors.slice(0, 3).join("; ")}` : "")
  );
  if (errors.length) process.exitCode = 1;
}

main()
  .catch((err) => {
    log(`FAILED: ${(err as Error).message}`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
