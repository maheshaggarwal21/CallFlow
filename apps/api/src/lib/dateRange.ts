/**
 * Canonical timezone for every call timestamp.
 *
 * The KoreCall PBX records wall-clock IST and the FTP service tags `called_at`
 * as `+05:30` (see `filenameParser.ts`), so a `date_from`/`date_to` sent by the
 * dashboard is always an **IST calendar date** — never a UTC one. Interpreting
 * those dates as UTC shifts every range 5h30m earlier, which silently bleeds the
 * previous day into "Today" and drops the last evening of "This Month".
 */
export const IST_TZ = "Asia/Kolkata";
export const IST_OFFSET = "+05:30";

/** SQL fragment: `called_at` re-expressed as IST wall-clock for bucketing. */
export const IST_LOCAL = `(called_at AT TIME ZONE '${IST_TZ}')`;

/** SQL fragment: start of the current IST day, as a timestamptz. */
export const IST_TODAY_START =
  `(date_trunc('day', now() AT TIME ZONE '${IST_TZ}') AT TIME ZONE '${IST_TZ}')`;

const DAY_MS = 24 * 60 * 60 * 1000;
const IST_SHIFT_MS = 5.5 * 60 * 60 * 1000;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const pad = (n: number) => String(n).padStart(2, "0");

/** IST calendar parts for an instant. IST has no DST, so a fixed shift is exact. */
function istParts(d: Date) {
  const s = new Date(d.getTime() + IST_SHIFT_MS);
  return {
    year:  s.getUTCFullYear(),
    month: s.getUTCMonth(),      // 0-based
    day:   s.getUTCDate(),
    hour:  s.getUTCHours(),
    dow:   s.getUTCDay(),        // 0 = Sunday
  };
}

/** Instant at IST midnight of the given IST calendar date. */
export function istMidnight(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month, day) - IST_SHIFT_MS);
}

/** `YYYY-MM-DD` of an instant, in IST. */
export function istDateKey(d: Date): string {
  const p = istParts(d);
  return `${p.year}-${pad(p.month + 1)}-${pad(p.day)}`;
}

/**
 * Inclusive lower bound of a range param. A bare `YYYY-MM-DD` means IST
 * midnight; anything else is parsed as a full instant.
 */
export function rangeStart(value?: string | null): Date | null {
  if (!value) return null;
  const d = DATE_ONLY.test(value)
    ? new Date(`${value}T00:00:00.000${IST_OFFSET}`)
    : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * **Exclusive** upper bound of a range param. A bare `YYYY-MM-DD` covers the
 * whole IST day, so it resolves to the *next* IST midnight — this is what makes
 * `date_to=2026-08-01` include 2026-08-01 23:59 instead of only midnight.
 */
export function rangeEnd(value?: string | null): Date | null {
  if (!value) return null;
  if (DATE_ONLY.test(value)) {
    const start = new Date(`${value}T00:00:00.000${IST_OFFSET}`);
    return Number.isNaN(start.getTime()) ? null : new Date(start.getTime() + DAY_MS);
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Resolve `date_from`/`date_to` into the half-open instant range `[start, end)`
 * used by every analytics query. Falls back to the current IST month.
 */
export function resolveRange(
  dateFrom?: string | null,
  dateTo?: string | null,
  now = new Date()
): { start: Date; end: Date; explicit: boolean } {
  const start = rangeStart(dateFrom);
  const end = rangeEnd(dateTo);

  if (start || end) {
    const p = istParts(now);
    return {
      start: start ?? new Date(0),
      // No `date_to` means "up to and including today" (IST).
      end: end ?? istMidnight(p.year, p.month, p.day + 1),
      explicit: true,
    };
  }

  const p = istParts(now);
  return {
    start: istMidnight(p.year, p.month, 1),
    end: istMidnight(p.year, p.month + 1, 1),
    explicit: false,
  };
}

// ── Activity bucketing ──────────────────────────────────────────────────────

export type Bucket = "hour" | "day" | "month";

/** Granularity that keeps a range readable: ≤1 day → hourly, ≤62 days → daily. */
export function pickBucket(start: Date, end: Date): Bucket {
  const hours = (end.getTime() - start.getTime()) / (60 * 60 * 1000);
  if (hours <= 25) return "hour";
  if (hours <= 62 * 24) return "day";
  return "month";
}

/** Postgres expression producing the text bucket key, aligned to IST. */
export function bucketKeyExpr(bucket: Bucket): string {
  const fmt = bucket === "hour" ? "YYYY-MM-DD HH24" : bucket === "day" ? "YYYY-MM-DD" : "YYYY-MM";
  return `to_char(${IST_LOCAL}, '${fmt}')`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function hourLabel(hour: number): string {
  const suffix = hour < 12 ? "a" : "p";
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h}${suffix}`;
}

/**
 * Every bucket key in `[start, end)` with its display label, so gaps render as
 * zero instead of disappearing from the chart.
 */
export function enumerateBuckets(
  start: Date,
  end: Date,
  bucket: Bucket
): Array<{ key: string; label: string }> {
  const out: Array<{ key: string; label: string }> = [];

  if (bucket === "month") {
    const s = istParts(start);
    const e = istParts(new Date(end.getTime() - 1));
    let year = s.year;
    let month = s.month;
    while (year < e.year || (year === e.year && month <= e.month)) {
      out.push({
        key: `${year}-${pad(month + 1)}`,
        label: `${MONTHS[month]} ${String(year).slice(2)}`,
      });
      month += 1;
      if (month > 11) { month = 0; year += 1; }
    }
    return out;
  }

  const step = bucket === "hour" ? 60 * 60 * 1000 : DAY_MS;
  // Align the first bucket to its own boundary so partial ranges still line up.
  const first = istParts(start);
  let cursor = bucket === "hour"
    ? istMidnight(first.year, first.month, first.day).getTime() + first.hour * 60 * 60 * 1000
    : istMidnight(first.year, first.month, first.day).getTime();

  const limit = end.getTime();
  while (cursor < limit && out.length < 400) {
    const p = istParts(new Date(cursor));
    if (bucket === "hour") {
      out.push({
        key: `${p.year}-${pad(p.month + 1)}-${pad(p.day)} ${pad(p.hour)}`,
        label: hourLabel(p.hour),
      });
    } else {
      out.push({
        key: `${p.year}-${pad(p.month + 1)}-${pad(p.day)}`,
        label: `${pad(p.day)} ${MONTHS[p.month]}`,
      });
    }
    cursor += step;
  }
  return out;
}
