/**
 * A rep's pay for a month — the ONE place that works it out (docs/salary-commission/EMPLOYEE-PAYMENT-FLOW.md).
 * The Employee Tracker (GET /employees/payroll), the rep's dashboard (GET /employees/me/summary and the Super
 * Admin's eye) and the Days view (GET /pay/days) all call `monthPay`, so the same rep and month can never show two
 * different numbers.
 *
 * Two rules, chosen per month:
 *  - "monthly" (every month before "Daily pay starts from", or while it is Off): the full fixed salary, pro-rated
 *    only for someone switched off during the month — exactly the rule used until 15 Nov 2026;
 *  - "daily": fixed salary ÷ working days × each working day's share from the ticked targets, earned so far.
 * Commission, extra commissions and deductions are the same in both.
 */
import pool from "../db/pool";
import { istDateKey } from "../lib/dateRange";
import {
  commissionOn, dailySalary, extrasAndDeductions, isTrial, monthBounds, monthPayout, proRated,
  type DayTargets, type PayDay, type PayDayInput, type PayPlan,
} from "../lib/payroll";
import { paymentsConfigured, paymentsFor, PaymentsError, type Payment } from "./payments.service";

/** The columns `monthPay` needs for each person (alias `e`). */
export const PAY_COLS = `e.id, e.name, e.role, e.status, e.employee_code, e.color_index,
  e.fix_salary, e.trial_commission::float, e.trial_commission_type, e.regular_commission::float, e.regular_commission_type,
  e.extra_commissions, e.extra_deductions, e.target_call_secs, e.target_trial, e.target_regular,
  e.tick_call, e.tick_trial, e.tick_regular, to_char(e.join_date, 'YYYY-MM-DD') AS join_date,
  CASE WHEN e.status = 'inactive' THEN to_char(e.left_on, 'YYYY-MM-DD') END AS left_on`;

export type PayEmployee = PayPlan & DayTargets & {
  id: string; name: string; role: string; status: string; employee_code: number; color_index: number;
  join_date: string | null; left_on: string | null;
};

// ── Working-days calendar (Super Admin, Working days panel) ────────────────────────────────────────────────────
export type PayCalendar = { weekdays: number[]; daily_pay_from: string | null };
let calCache: { at: number; v: PayCalendar } | null = null;
export const forgetPayCalendar = () => { calCache = null; };

export async function payCalendar(): Promise<PayCalendar> {
  if (calCache && Date.now() - calCache.at < 30_000) return calCache.v;
  const { rows } = await pool.query("SELECT key, value FROM pay_settings WHERE key IN ('weekdays', 'daily_pay_from')");
  const get = (k: string) => rows.find((r) => r.key === k)?.value;
  const wd = get("weekdays");
  const v: PayCalendar = {
    weekdays: Array.isArray(wd) ? wd.filter((n: unknown) => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= 7) : [1, 2, 3, 4, 5, 6],
    daily_pay_from: typeof get("daily_pay_from") === "string" ? get("daily_pay_from") : null,
  };
  calCache = { at: Date.now(), v };
  return v;
}

export async function holidaysBetween(from: string, to: string): Promise<Map<string, string>> {
  const { rows } = await pool.query("SELECT to_char(day, 'YYYY-MM-DD') AS day, name FROM holidays WHERE day BETWEEN $1 AND $2 ORDER BY day", [from, to]);
  return new Map(rows.map((r) => [r.day as string, r.name as string]));
}

export const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Daily pay applies to `month` when a start month is set and `month` is that month or later. */
export const isDailyMonth = (cal: PayCalendar, month: string) => !!cal.daily_pay_from && month >= cal.daily_pay_from;

// ── The calculation ─────────────────────────────────────────────────────────────────────────────────────────────
export type MonthPay = ReturnType<typeof commissionOn> & {
  id: string; mode: "monthly" | "daily"; month: string; from: string; to: string; cutoff: string;
  /** set when the school site's payments couldn't be read (commission and the joining targets are then incomplete) */
  error: string | null;
  /** monthly rule: the fixed salary (pro-rated for a leaver); daily rule: the salary earned so far (₹, may have paise) */
  base: number;
  extras: { name: string; amount: number }[]; deductions: { name: string; amount: number }[];
  /** earned so far: base + commission + extras − deductions, never below 0 (₹, may have paise under daily pay) */
  total: number;
  /** the day the person was switched off, when it falls in this month */
  left_on: string | null;
  /** monthly rule only: days paid of the month's days, for a leaver */
  days_paid: number; month_days: number;
  /** daily rule only */
  working_days: number | null; days_so_far: number | null; days: PayDay[] | null;
  /** the school site's payments up to the cutoff (for the dashboard's fees table) */
  payments: Payment[];
};

/**
 * Pay for each person for `month`, earned up to `today` (IST "YYYY-MM-DD"; the whole month for a past month).
 * The data for everyone is read in a handful of queries, whatever the number of people.
 */
export async function monthPay(emps: PayEmployee[], month: string, today: string = istDateKey(new Date()), preview?: PayCalendar): Promise<MonthPay[]> {
  const b = monthBounds(month);
  if (!b || emps.length === 0) return [];
  // `preview`: work it out with another calendar without saving anything (used to check real data before switching on)
  const cal = preview ?? await payCalendar();
  const daily = isDailyMonth(cal, month);
  const thisMonth = today.slice(0, 7);
  // last day that counts: the whole month for a past month, today for the running one, nothing for a future one
  const cutoff = month < thisMonth ? b.to : month === thisMonth ? today : addDays(b.from, -1);

  // payments, a few people at a time so a large team doesn't flood the school's server
  const connected = paymentsConfigured();
  const pay = new Map<string, { list: Payment[]; error: string | null }>();
  for (let i = 0; i < emps.length; i += 4) {
    await Promise.all(emps.slice(i, i + 4).map(async (e) => {
      // monthly rule: up to the day a leaver left (as before 15 Nov 2026); daily rule: up to the cutoff
      const last = daily ? (cutoff < b.to ? cutoff : b.to) : (e.left_on && e.left_on < b.to ? e.left_on : b.to);
      let list: Payment[] = [], error: string | null = null;
      if (connected && last >= b.from) {
        try { list = await paymentsFor(e.id, b.from, last); } catch (err) {
          if (!(err instanceof PaymentsError)) throw err;
          error = err.message;
        }
      }
      pay.set(e.id, { list, error });
    }));
  }

  if (!daily) {
    return emps.map((e) => {
      const { list, error } = pay.get(e.id)!;
      const last = e.left_on && e.left_on < b.to ? e.left_on : b.to;
      const monthDays = Number(b.to.slice(8)), days = Number(last.slice(8));
      const plan = last < b.to ? proRated(e, days, monthDays) : e;
      return {
        id: e.id, mode: "monthly" as const, month, from: b.from, to: b.to, cutoff: last, error,
        ...monthPayout(plan, list, b.from, last),
        left_on: e.left_on && e.left_on <= b.to ? e.left_on : null, days_paid: days, month_days: monthDays,
        working_days: null, days_so_far: null, days: null, payments: list,
      };
    });
  }

  // daily rule: everything for everyone in one go
  const ids = emps.map((e) => e.id);
  const end = cutoff < b.to ? cutoff : b.to;
  const [holidays, calls, snaps, era, overrides] = await Promise.all([
    holidaysBetween(b.from, b.to),
    end >= b.from
      ? pool.query(
        `SELECT employee_id, to_char((called_at AT TIME ZONE 'Asia/Kolkata')::date, 'YYYY-MM-DD') AS day, COALESCE(SUM(duration_secs), 0)::int AS secs
         FROM calls WHERE employee_id = ANY($1::uuid[])
           AND called_at >= ($2::date::timestamp AT TIME ZONE 'Asia/Kolkata') AND called_at < (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata')
         GROUP BY 1, 2`, [ids, b.from, end])
      : { rows: [] as { employee_id: string; day: string; secs: number }[] },
    pool.query(
      `SELECT employee_id, to_char(day, 'YYYY-MM-DD') AS day, target_call_secs, target_trial, target_regular, tick_call, tick_trial, tick_regular
       FROM day_targets WHERE day BETWEEN $1 AND $2`, [b.from, b.to]),
    pool.query("SELECT key, value FROM pay_settings WHERE key IN ('closed_from', 'closed_through')"),
    pool.query("SELECT employee_id, to_char(day, 'YYYY-MM-DD') AS day FROM day_overrides WHERE employee_id = ANY($1::uuid[]) AND day BETWEEN $2 AND $3", [ids, b.from, b.to]),
  ]);
  const secs = new Map(calls.rows.map((r) => [`${r.employee_id}|${r.day}`, Number(r.secs)]));
  const snap = new Map(snaps.rows.filter((r) => ids.includes(r.employee_id)).map((r) => [`${r.employee_id}|${r.day}`, r as DayTargets]));
  // the days that have been closed (a range kept by closeDays): on such a day, no row means not working here
  const kv = (k: string) => { const v = era.rows.find((r) => r.key === k)?.value; return typeof v === "string" ? v : null; };
  const closedFrom = kv("closed_from"), closedThrough = kv("closed_through");
  const isClosed = (day: string) => !!closedFrom && !!closedThrough && day >= closedFrom && day <= closedThrough;
  const full = new Set(overrides.rows.map((r) => `${r.employee_id}|${r.day}`));

  return emps.map((e) => {
    const { list, error } = pay.get(e.id)!;
    const byDay = new Map<string, { trial: number; regular: number }>();
    for (const p of list) {
      const c = byDay.get(p.paidDate) ?? { trial: 0, regular: 0 };
      if (isTrial(p)) c.trial++; else c.regular++;
      byDay.set(p.paidDate, c);
    }
    // working here on `day` by the current record: joined by then, and still active (or switched off that day or later)
    const onByRecord = (day: string) => (!e.join_date || e.join_date <= day) && (e.status === "active" || (!!e.left_on && day <= e.left_on));
    const input = new Map<string, PayDayInput>();
    for (let day = b.from; day <= end; day = addDays(day, 1)) {
      const s = snap.get(`${e.id}|${day}`);
      let targets: DayTargets | null;
      if (day === today) targets = onByRecord(day) ? e : null;                 // today: live, current targets
      else if (s) targets = (!e.join_date || e.join_date <= day) ? s : null;  // saved targets for that day
      else if (isClosed(day)) targets = null;                                  // a closed day without them: not working here
      else targets = onByRecord(day) ? e : null;                               // not closed (before closing began): current record
      const pd = byDay.get(day) ?? { trial: 0, regular: 0 };
      input.set(day, { day, targets, done: { call_secs: secs.get(`${e.id}|${day}`) ?? 0, trial: pd.trial, regular: pd.regular }, countAsFull: full.has(`${e.id}|${day}`) });
    }
    const sal = dailySalary(e, month, cutoff, cal.weekdays, holidays, input);
    const c = commissionOn(e, list);
    const { extras, deductions } = extrasAndDeductions(e, b.from, end, sal.salary_paise / 100 + c.commission);
    const plus = extras.reduce((t, x) => t + x.amount, 0), minus = deductions.reduce((t, x) => t + x.amount, 0);
    // salary is in paise (it can have paise); commission, extras and deductions are whole rupees
    const totalPaise = Math.max(0, sal.salary_paise + 100 * (c.commission + plus - minus));
    return {
      id: e.id, mode: "daily" as const, month, from: b.from, to: b.to, cutoff: end, error,
      ...c, base: sal.salary_paise / 100, extras, deductions, total: totalPaise / 100,
      left_on: e.left_on && e.left_on <= b.to ? e.left_on : null, days_paid: 0, month_days: Number(b.to.slice(8)),
      working_days: sal.working_days, days_so_far: sal.days_so_far, days: sal.days, payments: list,
    };
  });
}

/**
 * Close the days that ended (just after midnight IST, and on start-up): save each working person's targets and
 * ticks for every day from the last closed one up to yesterday, so a later change of target leaves them alone.
 * A day missed while the server was down is closed on the next run from the record as it is then.
 */
export async function closeDays(today: string = istDateKey(new Date())): Promise<number> {
  // the closed range is kept as two dates, so a day with nobody to save is still known to be closed
  const { rows } = await pool.query("SELECT key, value FROM pay_settings WHERE key IN ('closed_from', 'closed_through')");
  const kv = (k: string) => { const v = rows.find((r) => r.key === k)?.value; return typeof v === "string" ? v : null; };
  const through = kv("closed_through");
  const yesterday = addDays(today, -1);
  const floor = addDays(today, -40);
  let day: string = through ? addDays(through, 1) : yesterday;
  if (day < floor) day = floor;
  if (day > yesterday) return 0;
  const first = day;
  let n = 0;
  for (; day <= yesterday; day = addDays(day, 1)) {
    n += (await pool.query(
      `INSERT INTO day_targets (employee_id, day, target_call_secs, target_trial, target_regular, tick_call, tick_trial, tick_regular)
       SELECT e.id, $1::date, e.target_call_secs, e.target_trial, e.target_regular, e.tick_call, e.tick_trial, e.tick_regular
       FROM employees e
       WHERE (e.join_date IS NULL OR e.join_date <= $1::date) AND (e.status = 'active' OR e.left_on >= $1::date)
       ON CONFLICT DO NOTHING`, [day])).rowCount ?? 0;
  }
  await pool.query(
    `INSERT INTO pay_settings (key, value, updated_at) VALUES ('closed_through', $1::jsonb, NOW()), ('closed_from', $2::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE SET value = CASE WHEN pay_settings.key = 'closed_from' THEN pay_settings.value ELSE EXCLUDED.value END, updated_at = NOW()`,
    [JSON.stringify(yesterday), JSON.stringify(first)]);
  return n;
}

/** Production only: close days every 10 minutes (cheap when there is nothing to close). */
export function startDayCloser() {
  const run = () => closeDays().catch((e) => console.error("[pay] closing days failed:", (e as Error).message));
  run();
  setInterval(run, 10 * 60_000).unref();
}

/** "Today" for a request: the real IST date; outside production a test may pass `?as_of=YYYY-MM-DD`. */
export function requestToday(query: Record<string, unknown>): string {
  const a = query.as_of;
  if (process.env.NODE_ENV !== "production" && typeof a === "string" && /^\d{4}-\d{2}-\d{2}$/.test(a)) return a;
  return istDateKey(new Date());
}
