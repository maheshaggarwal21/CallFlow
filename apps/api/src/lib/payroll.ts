/**
 * A rep's pay from the school's payments (client, 13 Nov 2026). Pure: no DB, no network.
 *
 * Rules (confirm with the client, see docs/salary-commission/CURRENT-STATE.md):
 * - feeType "Trial" earns the trial rate; every other fee type earns the regular rate, so a rep keeps
 *   earning on each later monthly fee they collect (recurring commission).
 * - Rate type "pct" = % of the amount paid; "fix" = ₹ per payment.
 * - Fix salary and other amount are monthly. An extra commission or a deduction counts once in a
 *   month when its dates overlap that month; a % deduction is a % of the fix salary.
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
  const overlaps = (x: { from: string; to: string }) => x.from <= to && x.to >= from;
  const c = commissionOn(plan, payments);
  const extras = (plan.extra_commissions ?? []).filter(overlaps).map((x) => ({ name: x.name, amount: Math.round(x.amount) }));
  const deductions = (plan.extra_deductions ?? []).filter(overlaps).map((x) => ({
    name: x.name, amount: Math.round(x.type === "pct" ? (plan.fix_salary * x.amount) / 100 : x.amount),
  }));
  const plus = extras.reduce((t, x) => t + x.amount, 0);
  const minus = deductions.reduce((t, x) => t + x.amount, 0);
  const gross = plan.fix_salary + plan.other_amount + c.commission + plus;
  // a payout never goes below zero, whatever the deductions add up to
  return { ...c, base: plan.fix_salary, other: plan.other_amount, extras, deductions, total: Math.max(0, gross - minus) };
}

/** First and last IST date of a `YYYY-MM` month, or null if it isn't one. */
export function monthBounds(month: string): { from: string; to: string } | null {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!m) return null;
  const last = new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}
