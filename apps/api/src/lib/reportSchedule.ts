import { istDateKey, istMidnight, istParts } from "./dateRange";

export type Frequency = "daily" | "weekly" | "monthly";

const HOUR_MS = 60 * 60 * 1000;
// A report that missed its minute (pm2 restart, deploy) still goes out if the
// server is back within this window; later than that it is skipped, not sent late.
export const CATCH_UP_MS = HOUR_MS;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December"];
const pad = (n: number) => String(n).padStart(2, "0");

function dayLabel(d: Date): string {
  const p = istParts(d);
  return `${pad(p.day)} ${MONTHS[p.month]} ${p.year}`;
}

/**
 * The instant this schedule should send today, if `now` falls inside its send
 * window and today is a send day; otherwise null. `sendTime` is Postgres TIME
 * text ("19:00:00").
 */
export function dueSendAt(
  s: { frequency: Frequency; send_time: string; weekday: number | null },
  now: Date
): Date | null {
  const p = istParts(now);
  const [h, m] = s.send_time.split(":").map(Number);
  const sendAt = new Date(istMidnight(p.year, p.month, p.day).getTime() + (h * 60 + m) * 60 * 1000);
  const late = now.getTime() - sendAt.getTime();
  if (late < 0 || late >= CATCH_UP_MS) return null;
  if (s.frequency === "weekly" && p.dow !== s.weekday) return null;
  if (s.frequency === "monthly" && istParts(istMidnight(p.year, p.month, p.day + 1)).day !== 1) return null;
  return sendAt;
}

/**
 * Calls covered by a report sent at `sendAt`: today so far (daily), the last 7
 * days including today (weekly), or the month so far (monthly).
 */
export function reportWindow(frequency: Frequency, sendAt: Date) {
  const p = istParts(sendAt);
  const today = istMidnight(p.year, p.month, p.day);
  const start =
    frequency === "daily" ? today :
    frequency === "weekly" ? istMidnight(p.year, p.month, p.day - 6) :
    istMidnight(p.year, p.month, 1);
  const label =
    frequency === "daily" ? dayLabel(today) :
    frequency === "weekly" ? `${dayLabel(start)} – ${dayLabel(today)}` :
    `${MONTHS_LONG[p.month]} ${p.year}`;
  return { start, end: sendAt, label, periodKey: istDateKey(sendAt) };
}

/** Label for an arbitrary [start, end) range, end exclusive. */
export function rangeLabel(start: Date, end: Date): string {
  const a = dayLabel(start);
  const b = dayLabel(new Date(end.getTime() - 1));
  return a === b ? a : `${a} – ${b}`;
}
