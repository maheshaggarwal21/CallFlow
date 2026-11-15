/**
 * A rep's pay from the school's payments (client, 13 Nov 2026). Pure: no DB, no network.
 *
 * Rules (see docs/salary-commission/CURRENT-STATE.md):
 * - Commission goes to the rep the payment is filed under, and a renewal earns the same rate as the first
 *   regular fee (client, 14 Nov 2026), so each later monthly fee earns the regular rate again.
 * - feeType "Trial" earns the trial rate; every other fee type earns the regular rate. Still open with the
 *   client: whether "Other" (or a registration / late fee) should earn at all. The school's data has no
 *   student id, so a first fee can't be told from a renewal; a rule that needs that needs the field first.
 * - Rate type "pct" = % of the amount paid; "fix" = ₹ per payment.
 * - Fix salary is monthly (the old "other amount" was removed 15 Nov 2026: an extra commission or deduction does that job). An extra commission or a deduction is paid once, in the
 *   month its start date falls in (the form fills that with the day it is added); a % deduction is a % of
 *   the fix salary (client, 14 Nov 2026).
 * Money is kept in paise until the end, then rounded to whole rupees.
 */
export type RateType = "fix" | "pct";
export type PayPlan = {
  fix_salary: number;
  trial_commission: number; trial_commission_type: RateType;
  regular_commission: number; regular_commission_type: RateType;
  extra_commissions?: { name: string; amount: number; from: string; to: string }[];
  extra_deductions?: { name: string; type: RateType; amount: number; from: string; to: string }[];
};
export type PaidFee = { amountPaise: number; feeType: string };
export type Bucket = { count: number; fees: number; commission: number }; // fees and commission in ₹

export const isTrial = (p: PaidFee) => p.feeType.trim().toLowerCase() === "trial";

function bucket(fees: PaidFee[], rate: number, type: RateType): Bucket {
  const paise = fees.reduce((t, p) => t + p.amountPaise, 0);
  return {
    count: fees.length,
    fees: Math.round(paise / 100),
    commission: Math.round(type === "pct" ? (paise * rate) / 10_000 : fees.length * rate),
  };
}

/** One payment's commission to the paisa, for the fees table (totals are rounded once, in `bucket`). */
export function feeCommission(plan: PayPlan, p: PaidFee): number {
  const [rate, type] = isTrial(p) ? [plan.trial_commission, plan.trial_commission_type] : [plan.regular_commission, plan.regular_commission_type];
  return type === "pct" ? Math.round((p.amountPaise * rate) / 100) / 100 : rate;
}

/** Trial and regular commission on a set of payments. */
export function commissionOn(plan: PayPlan, payments: PaidFee[]) {
  const trial = bucket(payments.filter(isTrial), plan.trial_commission, plan.trial_commission_type);
  const regular = bucket(payments.filter((p) => !isTrial(p)), plan.regular_commission, plan.regular_commission_type);
  return { trial, regular, commission: trial.commission + regular.commission };
}

/** Whole-month payout. `from`/`to` are the month's first and last IST dates (YYYY-MM-DD). */
export function monthPayout(plan: PayPlan, payments: PaidFee[], from: string, to: string) {
  // once, in the month it starts: a range running into the next month isn't paid twice
  const startsIn = (x: { from: string }) => x.from >= from && x.from <= to;
  const c = commissionOn(plan, payments);
  const extras = (plan.extra_commissions ?? []).filter(startsIn).map((x) => ({ name: x.name, amount: Math.round(x.amount) }));
  const plus = extras.reduce((t, x) => t + x.amount, 0);
  const gross = plan.fix_salary + c.commission + plus;
  const deductions = deductionsOn(plan, startsIn, gross);
  const minus = deductions.reduce((t, x) => t + x.amount, 0);
  // a payout never goes below zero, whatever the deductions add up to
  return { ...c, base: plan.fix_salary, extras, deductions, total: Math.max(0, gross - minus) };
}

/**
 * The plan for someone who left during the month (client, 14 Nov 2026): fix salary for
 * the days worked, `days` of `monthDays` (option A, pro-rated). A % deduction is then a % of that month's total pay.
 */
export function proRated(plan: PayPlan, days: number, monthDays: number): PayPlan {
  const part = Math.min(Math.max(days, 0), monthDays) / monthDays;
  return { ...plan, fix_salary: Math.round(plan.fix_salary * part) };
}

/** First and last IST date of a `YYYY-MM` month, or null if it isn't one. */
export function monthBounds(month: string): { from: string; to: string } | null {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!m) return null;
  const last = new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

// ── Daily salary from targets (client, 15 Nov 2026; docs/salary-commission/EMPLOYEE-PAYMENT-FLOW.md) ──────────────

export type DayTargets = {
  target_call_secs: number; target_trial: number; target_regular: number;
  tick_call: boolean; tick_trial: boolean; tick_regular: boolean;
};
export type DayDone = { call_secs: number; trial: number; regular: number };
export type TargetKey = "call" | "trial" | "regular";
/** One ticked target on one day: what was done, the target, and the share paid in quarters (0, 2, 3 or 4). */
export type DayPart = { key: TargetKey; done: number; target: number; quarters: 0 | 2 | 3 | 4 };

/**
 * The share of one target that is paid, in quarters: below 50 % → 0, 50 % → 2 (½), 75 % → 3 (¾), 100 % or more → 4
 * (full; nothing extra above 100 %). Whole-number maths, so 74.999… % can never be read as 75 %.
 */
export function stepQuarters(done: number, target: number): 0 | 2 | 3 | 4 {
  if (done >= target) return 4;
  if (4 * done >= 3 * target) return 3;
  if (2 * done >= target) return 2;
  return 0;
}

/**
 * How much of the day salary a working day earns. Each ticked target with a value above 0 is an equal share;
 * no such target → the full day. "Count as full" → the full day. Returned as a fraction num / den in quarters
 * (num = sum of the shares' quarters, den = 4 × number of ticked targets) so money is rounded only once.
 */
export function dayShare(t: DayTargets, d: DayDone, countAsFull = false): { num: number; den: number; parts: DayPart[] } {
  const parts: DayPart[] = [];
  if (t.tick_call && t.target_call_secs > 0) parts.push({ key: "call", done: d.call_secs, target: t.target_call_secs, quarters: stepQuarters(d.call_secs, t.target_call_secs) });
  if (t.tick_trial && t.target_trial > 0) parts.push({ key: "trial", done: d.trial, target: t.target_trial, quarters: stepQuarters(d.trial, t.target_trial) });
  if (t.tick_regular && t.target_regular > 0) parts.push({ key: "regular", done: d.regular, target: t.target_regular, quarters: stepQuarters(d.regular, t.target_regular) });
  if (countAsFull || parts.length === 0) return { num: 1, den: 1, parts };
  return { num: parts.reduce((s, p) => s + p.quarters, 0), den: 4 * parts.length, parts };
}

/** The salary a day earns, in paise: fix salary × share ÷ working days, rounded once to the paisa. */
export function dayPaise(fixSalary: number, num: number, den: number, workingDays: number): number {
  if (workingDays <= 0 || den <= 0) return 0;
  return Math.round((fixSalary * 100 * num) / (den * workingDays));
}

/** ISO weekday of an IST date "YYYY-MM-DD": 1 = Monday … 7 = Sunday. */
export function isoWeekday(day: string): number {
  const w = new Date(`${day}T00:00:00Z`).getUTCDay();
  return w === 0 ? 7 : w;
}

/** Every date of a `YYYY-MM` month. */
export function monthDays(month: string): string[] {
  const b = monthBounds(month);
  if (!b) return [];
  const n = Number(b.to.slice(8));
  return Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
}

/** The month's working days: a ticked weekday that is not a holiday. */
export function workingDaysOf(month: string, weekdays: number[], holidays: { has(day: string): boolean }): string[] {
  const on = new Set(weekdays);
  return monthDays(month).filter((d) => on.has(isoWeekday(d)) && !holidays.has(d));
}

/** Extras and deductions paid in a month up to `cutoff` (once, in the month their start date falls in); a % deduction is a % of the full fixed salary. */
/**
 * Deductions (client, 15 Nov 2026): a % deduction is a % of the TOTAL pay before deductions (salary + commission +
 * extra commissions), not of the fixed salary; a ₹ one is taken as written.
 */
function deductionsOn(plan: PayPlan, startsIn: (x: { from: string }) => boolean, gross: number) {
  return (plan.extra_deductions ?? []).filter(startsIn).map((x) => ({
    name: x.name, amount: Math.round(x.type === "pct" ? (Math.max(0, gross) * x.amount) / 100 : x.amount),
  }));
}

/** Daily pay: extras and deductions for the month so far. `earned` = salary earned so far + commission (₹). */
export function extrasAndDeductions(plan: PayPlan, from: string, cutoff: string, earned: number) {
  const startsIn = (x: { from: string }) => x.from >= from && x.from <= cutoff;
  const extras = (plan.extra_commissions ?? []).filter(startsIn).map((x) => ({ name: x.name, amount: Math.round(x.amount) }));
  const deductions = deductionsOn(plan, startsIn, earned + extras.reduce((t, x) => t + x.amount, 0));
  return { extras, deductions };
}

export type PayDayInput = {
  day: string;
  /** null = not working here that day (before joining, after leaving, switched off) */
  targets: DayTargets | null;
  done: DayDone;
  countAsFull: boolean;
};
export type PayDay = {
  day: string; weekday: number;
  /** "working" a counted working day · "off" not a working weekday · "holiday" · "future" after today · "away" before joining / after leaving / switched off */
  kind: "working" | "off" | "holiday" | "future" | "away";
  holiday: string | null;
  done: DayDone | null; parts: DayPart[]; noTargets: boolean; countAsFull: boolean;
  num: number; den: number; paise: number;
};

/**
 * The salary part of a month under daily pay, up to and including `cutoff` (today for the running month).
 * Days are listed for the whole month so the Days view can show them; only working days up to `cutoff` earn.
 */
export function dailySalary(plan: PayPlan, month: string, cutoff: string, weekdays: number[], holidays: Map<string, string>, input: Map<string, PayDayInput>) {
  const working = workingDaysOf(month, weekdays, holidays);
  const W = working.length;
  const workSet = new Set(working);
  const days: PayDay[] = monthDays(month).map((day) => {
    const base = { day, weekday: isoWeekday(day), holiday: holidays.get(day) ?? null, done: null, parts: [], noTargets: false, countAsFull: false, num: 0, den: 1, paise: 0 };
    if (holidays.has(day)) return { ...base, kind: "holiday" as const };
    if (!workSet.has(day)) return { ...base, kind: "off" as const };
    if (day > cutoff) return { ...base, kind: "future" as const };
    const i = input.get(day);
    if (!i || !i.targets) return { ...base, kind: "away" as const, done: i?.done ?? null };
    const s = dayShare(i.targets, i.done, i.countAsFull);
    return { ...base, kind: "working" as const, done: i.done, parts: s.parts, noTargets: s.parts.length === 0, countAsFull: i.countAsFull,
      num: s.num, den: s.den, paise: dayPaise(plan.fix_salary, s.num, s.den, W) };
  });
  const paise = days.reduce((t, d) => t + d.paise, 0);
  return {
    days, working_days: W,
    /** working days up to the cutoff (whether or not anything was earned on them) */
    days_so_far: days.filter((d) => d.kind === "working" || d.kind === "away").length,
    salary_paise: paise,
  };
}
