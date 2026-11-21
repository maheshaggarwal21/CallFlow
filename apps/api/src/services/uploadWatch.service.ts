// Mails UPLOAD_ALERT_TO (comma-separated, server .env) when an office's KoreCall stops sending recordings.
// The rules are in lib/uploadWatch.ts; this only reads the database, mails, and remembers what it already sent
// (pay_settings key 'upload_watch', so a restart doesn't mail twice).
import pool from "../db/pool";
import { sendMail } from "./mail.service";
import { payCalendar, holidaysBetween } from "./pay.service";
import { istDateKey } from "../lib/dateRange";
import { isoWeekday } from "../lib/payroll";
import { decide, OFFICE_LINES, WATCH_FROM, WATCH_TO, type Action, type Alerted } from "../lib/uploadWatch";

const istAt = (day: string, hhmm: string) => Date.parse(`${day}T${hhmm}:00+05:30`);
const clock = (ms: number) => new Date(ms).toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const recipients = () => (process.env.UPLOAD_ALERT_TO ?? "").split(",").map((s) => s.trim()).filter(Boolean);

function mailFor(a: Action, now: number): { subject: string; text: string } {
  const name = a.who === "both" ? "Neither office" : `Office ${a.who}`;
  const lines = a.who === "both" ? "lines 01–08" : `lines ${OFFICE_LINES[a.who][0]}–${OFFICE_LINES[a.who][3]}`;
  if (a.kind === "back") {
    return {
      subject: `CallFlow: ${a.who === "both" ? "recordings" : `Office ${a.who} recordings`} arriving again`,
      text: `${a.who === "both" ? "Recordings are" : `Office ${a.who} (${lines}) is`} sending recordings again (latest at ${clock(a.since)}).\n\n` +
        `Calls made while it was not sending may be missing from CallFlow. They are still saved in the KoreCall box and can be sent again from there.`,
    };
  }
  const mins = Math.round((now - a.since) / 60_000);
  return {
    subject: `CallFlow alert: ${name === "Neither office" ? "no recordings from either office" : `${name} has sent no recordings since ${clock(a.since)}`}`,
    text: a.who === "both"
      ? `No recordings have reached CallFlow from either office for ${mins} minutes (since ${clock(a.since)}).\n\n` +
        `If calls are going on, please check the internet in both offices and restart the KoreCall boxes. If it continues, the CallFlow server may need checking.`
      : `${name} (${lines}) has sent no recordings for ${mins} minutes (since ${clock(a.since)}), while Office ${a.who === "1" ? "2" : "1"} is sending normally.\n\n` +
        `Please restart the ${name} KoreCall box and its internet router, then make one test call: it should show on the Recordings tab within a minute.\n\n` +
        `Calls made in the meantime stay saved in the KoreCall box.`,
  };
}

async function workingDay(day: string) {
  const [cal, hol] = await Promise.all([payCalendar(), holidaysBetween(day, day)]);
  return cal.weekdays.includes(isoWeekday(day)) && !hol.has(day);
}

export async function checkUploads(now = Date.now()) {
  const to = recipients();
  if (!to.length) return;
  const day = istDateKey(new Date(now));
  const dayStart = istAt(day, WATCH_FROM);
  if (now < dayStart || now >= istAt(day, WATCH_TO) || !(await workingDay(day))) return;

  const { rows } = await pool.query(
    `SELECT MAX(created_at) FILTER (WHERE line_number = ANY($2)) AS o1, MAX(created_at) FILTER (WHERE line_number = ANY($3)) AS o2
       FROM calls WHERE created_at >= $1`,
    [new Date(istAt(day, "00:00")), OFFICE_LINES[1], OFFICE_LINES[2]],
  );
  const ms = (d: Date | null) => (d ? new Date(d).getTime() : null);
  const saved = (await pool.query("SELECT value FROM pay_settings WHERE key = 'upload_watch'")).rows[0]?.value;
  const alerted: Alerted = saved?.day === day ? saved.alerted ?? {} : {};

  for (const a of decide(now, dayStart, ms(rows[0].o1), ms(rows[0].o2), alerted)) {
    try {
      await sendMail({ to, ...mailFor(a, now) });
    } catch (e) {
      console.error(`[upload-watch] mail failed, will retry: ${(e as Error).message}`);
      continue; // not remembered, so the next check tries again
    }
    console.log(`[upload-watch] mailed: ${a.kind} ${a.who}`);
    alerted[a.who] = a.kind === "silent";
    await pool.query(
      `INSERT INTO pay_settings (key, value, updated_at) VALUES ('upload_watch', $1::jsonb, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [JSON.stringify({ day, alerted })],
    );
  }
}

/** Every 5 minutes inside the API (production only, like the report mails). */
export function startUploadWatch() {
  if (!recipients().length) { console.log("[upload-watch] off: UPLOAD_ALERT_TO is not set"); return; }
  const run = () => void checkUploads().catch((e) => console.error("[upload-watch] check failed:", (e as Error).message));
  run();
  setInterval(run, 5 * 60_000).unref();
}
