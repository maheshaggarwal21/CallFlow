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
  commissionOn, dailySalary, dayPaise, extrasAndDeductions, isTrial, monthBounds, monthPayout, proRated,
  type DayTargets, type PayDay, type PayDayInput, type PayPlan,
} from "../lib/payroll";
import { paymentsConfigured, paymentsFor, PaymentsError, type Payment } from "./payments.service";

/** The columns `monthPay` needs for each person (alias `e`). */
export const PAY_COLS = `e.id, e.name, e.role, e.status, e.employee_code, e.color_index,
  e.fix_salary, e.trial_commission::float, e.trial_commission_type, e.regular_commission::float, e.regular_commission_type,
  e.extra_commissions, e.extra_deductions, e.target_call_secs, e.target_trial, e.target_regular,
  e.tick_call, e.tick_trial, e.tick_regular, to_char(e.join_date, 'YYYY-MM-DD') AS join_date,
  CASE WHEN e.status = 'inactive' THEN to_char(e.left_on, 'YYYY-MM-DD') END AS left_on,
  to_char((e.created_at AT TIME ZONE 'Asia/Kolkata')::date, 'YYYY-MM-DD') AS created_on`;

export type PayEmployee = PayPlan & DayTargets & {
  id: string; name: string; role: string; status: string; employee_code: number; color_index: number;
  join_date: string | null; left_on: string | null;
  /** the day the account was made (IST): days from the joining date before it were never saved by the day closer */
  created_on?: string | null;
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
  /** month close (client, 17 Nov 2026): true = the saved final copy; open_until = the last day late payments still count */
  final: boolean; open_until: string | null;
};

/**
 * Pay for each person for `month`, earned up to `today` (IST "YYYY-MM-DD"; the whole month for a past month).
 * The data for everyone is read in a handful of queries, whatever the number of people.
 */
export async function monthPay(emps: PayEmployee[], month: string, today: string = istDateKey(new Date()), preview?: PayCalendar): Promise<MonthPay[]> {
  // a closed month is its saved copy (a preview — another calendar — is always worked out live)
  if (!preview && month >= LOCK_FROM && emps.length) {
    const { rows: [closed] } = await pool.query("SELECT 1 FROM months_closed WHERE month = $1", [month]);
    if (closed) {
      const { rows } = await pool.query("SELECT employee_id, pay FROM month_close WHERE month = $1 AND employee_id = ANY($2::uuid[])", [month, emps.map((e) => e.id)]);
      const saved = new Map(rows.map((r) => [r.employee_id as string, r.pay as MonthPay]));
      const missing = emps.filter((e) => !saved.has(e.id));
      const live = missing.length ? await livePay(missing, month, today) : [];
      return emps.map((e) => ({ ...(saved.get(e.id) ?? live.find((x) => x.id === e.id)!), final: true, open_until: openUntil(month) }));
    }
  }
  return livePay(emps, month, today, preview);
}

// ── Month close (client, 17 Nov 2026) ──────────────────────────────────────────────────────────────────────────
/** The first month that closes; earlier months are worked out live, as before. */
export const LOCK_FROM = "2026-11";
export const nextMonth = (m: string) => addDays(`${m}-28`, 7).slice(0, 7);
/** The last day a month is still open: late payments dated in it count until the 10th of the next month. */
export const openUntil = (m: string) => `${nextMonth(m)}-10`;

/**
 * Close every month whose 10 days have passed: save each person's month pay as it is now. Not while the school's
 * payments can't be read for someone who is linked (a month never closes with payments missing; the next run tries
 * again). Returns the months closed.
 */
export async function closeMonths(today: string = istDateKey(new Date())): Promise<string[]> {
  const done: string[] = [];
  for (let m = LOCK_FROM; openUntil(m) < today; m = nextMonth(m)) {
    if ((await pool.query("SELECT 1 FROM months_closed WHERE month = $1", [m])).rows[0]) continue;
    const b = monthBounds(m)!;
    const { rows } = await pool.query(`SELECT ${PAY_COLS} FROM employees e WHERE (e.status = 'active' OR e.left_on >= $1::date)`, [b.from]);
    const pays = await livePay(rows as PayEmployee[], m, today);
    const broken = pays.filter((p) => p.error && !/isn't linked/.test(p.error));
    if (broken.length) { console.error(`[pay] ${m} not closed: payments unreadable for ${broken.length} person(s); will try again`); continue; }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO months_closed (month) VALUES ($1) ON CONFLICT DO NOTHING", [m]);
      for (const p of pays) {
        await client.query("INSERT INTO month_close (month, employee_id, pay) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
          [m, p.id, JSON.stringify({ ...p, final: true, open_until: openUntil(m) })]);
      }
      await client.query("COMMIT");
      done.push(m);
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }
  return done;
}

/**
 * Payments dated in a closed month that show up after it closed (looked for once a day, last 3 closed months):
 * listed in late_payments for the Super Admin, never added to any month (client: a payment belongs to its paid date).
 */
export async function findLatePayments(today: string = istDateKey(new Date())): Promise<number> {
  if (!paymentsConfigured()) return 0;
  const { rows: months } = await pool.query("SELECT month FROM months_closed ORDER BY month DESC LIMIT 3");
  let found = 0;
  for (const { month } of months) {
    const b = monthBounds(month.trim())!;
    const { rows } = await pool.query(
      `SELECT c.pay, ${PAY_COLS} FROM month_close c JOIN employees e ON e.id = c.employee_id WHERE c.month = $1`, [month]);
    for (const r of rows) {
      const known = new Set(((r.pay as MonthPay).payments ?? []).map((p) => p.id));
      let now: Payment[];
      try { now = await paymentsFor(r.id, b.from, b.to, true); } catch { continue; }
      for (const p of now.filter((x) => !known.has(x.id))) {
        const c = commissionOn(r as PayEmployee, [p]);
        found += (await pool.query(
          `INSERT INTO late_payments (month, employee_id, payment_id, paid_date, amount, commission) VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT DO NOTHING`, [month.trim(), r.id, p.id, p.paidDate, p.amountPaise / 100, c.commission])).rowCount ?? 0;
      }
    }
  }
  return found;
}

/** The pay of everyone for `month`, worked out from the live data (what monthPay shows until the month closes). */
async function livePay(emps: PayEmployee[], month: string, today: string, preview?: PayCalendar): Promise<MonthPay[]> {
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
        final: false, open_until: month >= LOCK_FROM ? openUntil(month) : null,
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
      // a closed day without them: not working here — unless it is before the account existed but on/after the joining
      // date set by hand (the rep started before they were added; client, 17 Nov 2026): then it is a working day, so
      // the Super Admin can "Count as full"
      else if (isClosed(day)) targets = e.join_date && e.created_on && day >= e.join_date && day < e.created_on && onByRecord(day) ? e : null;
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
      final: false, open_until: month >= LOCK_FROM ? openUntil(month) : null,
    };
  });
}

// ── Targets over a period (rep's dashboard, client 16 Nov 2026) ─────────────────────────────────────────────────
export type PeriodTargets =
  | { too_long: true }
  | {
    too_long: false; from: string; to: string;
    /** working days in the period up to today on which the rep was working here (not before joining / after leaving) */
    working_days: number;
    /** each target ticked on at least one of those days: met on `met` of `of` days, and one dot per day */
    targets: { key: "call" | "trial" | "regular"; met: number; of: number; days: { day: string; quarters: number }[] }[];
    /** daily pay only (every month in the period): salary earned in these days of the most they could have earned */
    salary: { earned: number; possible: number } | null;
  };

/**
 * How often the rep met each ticked target over a period, from the SAME per-day results as the Days list and the
 * pay (a month that isn't on daily pay is worked out with a preview calendar, nothing saved). Targets are never added
 * up over the period: pay is per day, so "met on 9 of 12 days" is what matches the salary. Up to 3 months.
 */
export async function periodTargets(e: PayEmployee, from: string, to: string, today: string, reuse?: MonthPay): Promise<PeriodTargets> {
  const last = to < today ? to : today;
  const months: string[] = [];
  for (let m = from.slice(0, 7); m <= last.slice(0, 7) && months.length <= 3; m = addDays(`${m}-28`, 7).slice(0, 7)) months.push(m);
  if (months.length > 3) return { too_long: true };
  const cal = await payCalendar();
  const T = { call: { met: 0, of: 0, days: [] as { day: string; quarters: number }[] }, trial: { met: 0, of: 0, days: [] as { day: string; quarters: number }[] }, regular: { met: 0, of: 0, days: [] as { day: string; quarters: number }[] } };
  let working = 0, earned = 0, possible = 0, allDaily = true;
  for (const m of months) {
    const daily = isDailyMonth(cal, m);
    allDaily &&= daily;
    const p = reuse && daily && reuse.month === m && reuse.days ? reuse : (await monthPay([e], m, today, daily ? undefined : { ...cal, daily_pay_from: m }))[0];
    if (!p?.days) continue;
    for (const d of p.days) {
      if (d.day < from || d.day > last || d.kind !== "working") continue;
      working++;
      earned += d.paise;
      possible += dayPaise(e.fix_salary, 1, 1, p.working_days ?? 0);
      for (const part of d.parts) {
        T[part.key].of++;
        if (part.quarters === 4) T[part.key].met++;
        T[part.key].days.push({ day: d.day, quarters: part.quarters });
      }
    }
  }
  return {
    too_long: false, from, to: last, working_days: working,
    targets: (["call", "trial", "regular"] as const).filter((k) => T[k].of > 0).map((k) => ({ key: k, ...T[k] })),
    salary: allDaily ? { earned: earned / 100, possible: possible / 100 } : null,
  };
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
  let lateCheckedOn = "";
  const run = async () => {
    await closeDays().catch((e) => console.error("[pay] closing days failed:", (e as Error).message));
    // month close (client, 17 Nov 2026): a month closes after the 10th of the next one; late payments are looked for once a day
    await closeMonths().then((m) => m.length && console.log(`[pay] closed ${m.join(", ")}`)).catch((e) => console.error("[pay] closing months failed:", (e as Error).message));
    const today = istDateKey(new Date());
    if (lateCheckedOn !== today) {
      lateCheckedOn = today;
      await findLatePayments(today).then((n) => n && console.log(`[pay] ${n} late payment(s) found for closed months`)).catch((e) => console.error("[pay] late payments check failed:", (e as Error).message));
    }
  };
  void run();
  setInterval(() => void run(), 10 * 60_000).unref();
}

/** "Today" for a request: the real IST date; outside production a test may pass `?as_of=YYYY-MM-DD`. */
export function requestToday(query: Record<string, unknown>): string {
  const a = query.as_of;
  if (process.env.NODE_ENV !== "production" && typeof a === "string" && /^\d{4}-\d{2}-\d{2}$/.test(a)) return a;
  return istDateKey(new Date());
}
