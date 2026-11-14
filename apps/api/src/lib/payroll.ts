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
 * - Fix salary and other amount are monthly. An extra commission or a deduction is paid once, in the
 *   month its start date falls in (the form fills that with the day it is added); a % deduction is a % of
 *   the fix salary (client, 14 Nov 2026).
 * Money is kept in paise until the end, then rounded to whole rupees.
 */
export type RateType = "fix" | "pct";
export type PayPlan = {
  fix_salary: number; other_amount: number;
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
  const deductions = (plan.extra_deductions ?? []).filter(startsIn).map((x) => ({
    name: x.name, amount: Math.round(x.type === "pct" ? (plan.fix_salary * x.amount) / 100 : x.amount),
  }));
  const plus = extras.reduce((t, x) => t + x.amount, 0);
  const minus = deductions.reduce((t, x) => t + x.amount, 0);
  const gross = plan.fix_salary + plan.other_amount + c.commission + plus;
  // a payout never goes below zero, whatever the deductions add up to
  return { ...c, base: plan.fix_salary, other: plan.other_amount, extras, deductions, total: Math.max(0, gross - minus) };
}

/**
 * The plan for someone who left during the month (client, 14 Nov 2026): fix salary and other amount for
 * the days worked, `days` of `monthDays` (option A, pro-rated). A % deduction is then a % of that salary.
 */
export function proRated(plan: PayPlan, days: number, monthDays: number): PayPlan {
  const part = Math.min(Math.max(days, 0), monthDays) / monthDays;
  return { ...plan, fix_salary: Math.round(plan.fix_salary * part), other_amount: Math.round(plan.other_amount * part) };
}

/** First and last IST date of a `YYYY-MM` month, or null if it isn't one. */
export function monthBounds(month: string): { from: string; to: string } | null {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!m) return null;
  const last = new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}
