/**
 * One source of truth for the date-range presets used by the dashboard and the
 * employee pages.
 *
 * Ranges are expressed as **IST calendar dates** (`YYYY-MM-DD`) because every
 * `called_at` is stored as IST wall-clock (see `lib/datetime.ts`). Building them
 * with `new Date().toISOString().slice(0, 10)` — as the pages used to — silently
 * rolls the date back a day for any viewer east of UTC, which is what made
 * "Today" on the dashboard return the same numbers as "This Month".
 */

const IST_SHIFT_MS = 5.5 * 60 * 60 * 1000;
const pad = (n: number) => String(n).padStart(2, "0");

/** Calendar parts of an instant, in IST. IST has no DST, so the shift is exact. */
function istParts(d: Date) {
  const s = new Date(d.getTime() + IST_SHIFT_MS);
  return { year: s.getUTCFullYear(), month: s.getUTCMonth(), day: s.getUTCDate() };
}

/** `YYYY-MM-DD` for an IST calendar date, normalising out-of-range day/month. */
function istKey(year: number, month: number, day: number): string {
  const d = new Date(Date.UTC(year, month, day));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Today's date in IST, as `YYYY-MM-DD`. */
export function istToday(now = new Date()): string {
  const p = istParts(now);
  return istKey(p.year, p.month, p.day);
}

export type Period =
  | "today"
  | "yesterday"
  | "week"
  | "month"
  | "last_month"
  | "all"
  | "custom";

export const PERIODS: { key: Period; label: string }[] = [
  { key: "today",      label: "Today" },
  { key: "yesterday",  label: "Yesterday" },
  { key: "week",       label: "Last 7 Days" },
  { key: "month",      label: "This Month" },
  { key: "last_month", label: "Last Month" },
  { key: "all",        label: "All Time" },
  { key: "custom",     label: "Custom Range" },
];

/** Shared default across the dashboard and every employee view. */
export const DEFAULT_PERIOD: Period = "today";

export type DateRange = { date_from?: string; date_to?: string };

/** Preset → inclusive IST date range. Both bounds are whole IST days. */
export function resolvePeriodRange(
  period: Period,
  customFrom?: string,
  customTo?: string,
  now = new Date()
): DateRange {
  const { year, month, day } = istParts(now);
  const today = istKey(year, month, day);

  switch (period) {
    case "today":
      return { date_from: today, date_to: today };
    case "yesterday": {
      const y = istKey(year, month, day - 1);
      return { date_from: y, date_to: y };
    }
    case "week":
      // Rolling 7 days, today inclusive.
      return { date_from: istKey(year, month, day - 6), date_to: today };
    case "month":
      return { date_from: istKey(year, month, 1), date_to: today };
    case "last_month":
      return {
        date_from: istKey(year, month - 1, 1),
        date_to: istKey(year, month, 0), // day 0 = last day of the previous month
      };
    case "custom":
      return {
        date_from: customFrom || undefined,
        date_to: customTo || undefined,
      };
    case "all":
    default:
      return { date_from: "2000-01-01", date_to: today };
  }
}

/** Query-string fragment for a range, e.g. `date_from=…&date_to=…`. */
export function rangeParams(range: DateRange): URLSearchParams {
  const p = new URLSearchParams();
  if (range.date_from) p.set("date_from", range.date_from);
  if (range.date_to) p.set("date_to", range.date_to);
  return p;
}

/** Sentence fragment for card subtitles, e.g. "Inbound vs outbound today". */
export function periodPhrase(period: Period): string {
  switch (period) {
    case "today":      return "today";
    case "yesterday":  return "yesterday";
    case "week":       return "over the last 7 days";
    case "month":      return "this month";
    case "last_month": return "last month";
    case "custom":     return "in the selected range";
    case "all":
    default:           return "all time";
  }
}

/** Label for the activity chart, which buckets hourly for single-day ranges. */
export function activityPhrase(period: Period): string {
  return period === "today" || period === "yesterday"
    ? `Hourly call volume ${periodPhrase(period)}`
    : `Call volume ${periodPhrase(period)}`;
}
