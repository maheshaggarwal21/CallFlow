// Run: npm run build && node --test dist/lib/payroll.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { commissionOn, feeCommission, monthBounds, monthPayout, type PayPlan } from "./payroll";

const plan: PayPlan = {
  fix_salary: 20000, other_amount: 1000,
  trial_commission: 100, trial_commission_type: "fix",
  regular_commission: 10, regular_commission_type: "pct",
};
const fees = [
  { amountPaise: 50_000, feeType: "Trial" }, { amountPaise: 50_000, feeType: " trial " },
  { amountPaise: 299_950, feeType: "Monthly" }, { amountPaise: 1_000_000, feeType: "Quarterly" },
];

test("trial pays ₹ each, every other fee type pays % of the amount", () => {
  const c = commissionOn(plan, fees);
  assert.deepEqual(c.trial, { count: 2, fees: 1000, commission: 200 });
  // 10% of ₹2,999.50 + ₹10,000 = ₹1,299.95 → ₹1,300
  assert.deepEqual(c.regular, { count: 2, fees: 13000, commission: 1300 });
  assert.equal(c.commission, 1500);
});

test("no payments, no commission", () => {
  assert.equal(commissionOn(plan, []).commission, 0);
});

test("extras and deductions count when their dates overlap the month", () => {
  const p: PayPlan = {
    ...plan,
    extra_commissions: [
      { name: "In", amount: 500, from: "2026-10-25", to: "2026-11-02" },
      { name: "Before", amount: 900, from: "2026-10-01", to: "2026-10-31" },
    ],
    extra_deductions: [
      { name: "Late", type: "pct", amount: 10, from: "2026-11-30", to: "2026-12-05" },
      { name: "Fine", type: "fix", amount: 250, from: "2026-11-10", to: "2026-11-10" },
      { name: "After", type: "fix", amount: 999, from: "2026-12-01", to: "2026-12-31" },
    ],
  };
  const r = monthPayout(p, fees, "2026-11-01", "2026-11-30");
  assert.deepEqual(r.extras, [{ name: "In", amount: 500 }]);
  assert.deepEqual(r.deductions, [{ name: "Late", amount: 2000 }, { name: "Fine", amount: 250 }]);
  // 20000 + 1000 + 1500 + 500 − 2250
  assert.equal(r.total, 20750);
});

test("payout never goes below zero", () => {
  const p: PayPlan = { ...plan, extra_deductions: [{ name: "Big", type: "fix", amount: 1_000_000, from: "2026-11-01", to: "2026-11-30" }] };
  assert.equal(monthPayout(p, [], "2026-11-01", "2026-11-30").total, 0);
});

test("month bounds, leap years, bad input", () => {
  assert.deepEqual(monthBounds("2026-11"), { from: "2026-11-01", to: "2026-11-30" });
  assert.deepEqual(monthBounds("2028-02"), { from: "2028-02-01", to: "2028-02-29" });
  assert.equal(monthBounds("2026-13"), null);
  assert.equal(monthBounds("2026-1"), null);
  assert.equal(monthBounds("x"), null);
});

test("a single fee's commission keeps paise, so the fees table adds up to the total", () => {
  assert.equal(feeCommission(plan, { amountPaise: 299_950, feeType: "Monthly" }), 299.95);
  assert.equal(feeCommission(plan, { amountPaise: 50_000, feeType: "Trial" }), 100);
  const rows = fees.map((p) => feeCommission(plan, p)).reduce((t, x) => t + x, 0);
  assert.equal(Math.round(rows), commissionOn(plan, fees).commission);
});
