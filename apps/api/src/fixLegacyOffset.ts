/**
 * Backfill for the legacy "+5:30 stored twice" bug.
 *
 * ── The defect ──────────────────────────────────────────────────────────────
 * Before `filenameParser.ts` learned to pin the timestamp to `+05:30`, the FTP
 * service built `called_at` with a bare `new Date("YYYY-MM-DDTHH:mm:ss")`. On a
 * server running UTC that reads the PBX's IST wall-clock AS UTC, storing every
 * call 5h30m too late. The parser was fixed — every row ingested from
 * 2026-06-11 on is correct — but the rows already in the table were never
 * backfilled, so 2026-05-09 → 2026-06-11 is still shifted.
 *
 * That shift is why the dashboard shows a wall of 18:00–23:59 calls in May with
 * nothing before 14:00: a real 09:30 call is stored as 15:00, and a real 17:00
 * call as 22:30.
 *
 * ── The repair ──────────────────────────────────────────────────────────────
 * The filename timestamp is the ground truth, so we simply re-derive `called_at`
 * from it. We only touch rows whose current value is off by EXACTLY +330
 * minutes, which:
 *   - cannot collide with the PBX clock-drift windows (those are 14–38h off,
 *     never 5.5h — see fixClockDrift.ts), and
 *   - makes the script idempotent: once a row is correct its diff is 0 and it
 *     is skipped.
 *
 * ── Usage ───────────────────────────────────────────────────────────────────
 *   npx ts-node-dev src/fixLegacyOffset.ts             # dry run
 *   npx ts-node-dev src/fixLegacyOffset.ts --apply     # writes, after a backup
 *   npx ts-node-dev src/fixLegacyOffset.ts --revert <backup.json>
 */
import * as fs from "fs";
import pool from "./db/pool";

const SHIFT_MIN = 330; // 5h30m
const DT = /---?-?(20\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{6})-/;

const nominalOf = (key: string): Date | null => {
  const m = key.split("/").pop()?.match(DT);
  if (!m) return null;
  const ts = m[1];
  return new Date(
    `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}T` +
    `${ts.slice(8, 10)}:${ts.slice(10, 12)}:${ts.slice(12, 14)}+05:30`
  );
};

const istHour = (d: Date) => new Date(d.getTime() + 5.5 * 3600e3).getUTCHours();

async function main() {
  const apply = process.argv.includes("--apply");

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

  const { rows } = await pool.query<{ source_file_key: string; called_at: Date }>(
    "SELECT source_file_key, called_at FROM calls WHERE source = 'korecall'"
  );

  const targets: Array<{ key: string; from: Date; to: Date }> = [];
  for (const r of rows) {
    const nominal = nominalOf(r.source_file_key);
    if (!nominal) continue;
    if (Math.round((+r.called_at - +nominal) / 60000) !== SHIFT_MIN) continue;
    targets.push({ key: r.source_file_key, from: r.called_at, to: nominal });
  }

  const oohBefore = targets.filter(t => istHour(t.from) < 8 || istHour(t.from) >= 18).length;
  const oohAfter  = targets.filter(t => istHour(t.to)   < 8 || istHour(t.to)   >= 18).length;
  const days = [...new Set(targets.map(t => t.to.toISOString().slice(0, 10)))].sort();

  console.log(
    `${targets.length} rows are shifted by exactly +5:30.\n` +
    `  affected days : ${days[0]} .. ${days[days.length - 1]} (${days.length} days)\n` +
    `  out-of-hours  : ${oohBefore} now -> ${oohAfter} after correction\n`
  );

  if (!targets.length) { console.log("Nothing to do."); await pool.end(); return; }
  if (!apply) { console.log("Dry run — nothing written. Re-run with --apply."); await pool.end(); return; }

  const backupPath = `./legacy-offset-backup-${Date.now()}.json`;
  fs.writeFileSync(backupPath, JSON.stringify(
    targets.map(t => ({ source_file_key: t.key, called_at: t.from.toISOString() }))));
  console.log(`Backed up ${targets.length} rows -> ${backupPath}`);

  const client = await pool.connect();
  let updated = 0;
  try {
    await client.query("BEGIN");
    for (const t of targets) {
      const r = await client.query(
        "UPDATE calls SET called_at = $1 WHERE source_file_key = $2 AND called_at IS DISTINCT FROM $1",
        [t.to.toISOString(), t.key]
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

  console.log(`Updated ${updated} rows. Revert with:\n  npx ts-node-dev src/fixLegacyOffset.ts --revert ${backupPath}`);
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
