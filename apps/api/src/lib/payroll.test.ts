// Run: npm run build && node --test dist/lib/payroll.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { commissionOn, feeCommission, monthBounds, monthPayout, proRated, type PayPlan } from "./payroll";

const plan: PayPlan = {
  fix_salary: 20000,
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

test("an extra or deduction counts once, in the month it starts (client, 14 Nov 2026)", () => {
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
  // "In" runs 25 Oct – 2 Nov: it started in October, so November doesn't pay it again
  assert.deepEqual(r.extras, []);
  // the % deduction is 10 % of salary + commission (20000 + 1500), not of the fixed salary alone (client, 15 Nov 2026)
  assert.deepEqual(r.deductions, [{ name: "Late", amount: 2150 }, { name: "Fine", amount: 250 }]);
  // 21500 − 2150 − 250
  assert.equal(r.total, 19100);
  assert.deepEqual(monthPayout(p, [], "2026-10-01", "2026-10-31").extras, [{ name: "In", amount: 500 }, { name: "Before", amount: 900 }]);
  assert.deepEqual(monthPayout(p, [], "2026-12-01", "2026-12-31").deductions, [{ name: "After", amount: 999 }]);
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

test("someone who left mid-month gets salary for the days worked; % deduction on that month's total", () => {
  const p: PayPlan = { ...plan, extra_deductions: [{ name: "Late", type: "pct", amount: 10, from: "2026-11-01", to: "2026-11-30" }] };
  const half = proRated(p, 15, 30);
  assert.equal(half.fix_salary, 10000);
  const r = monthPayout(half, fees, "2026-11-01", "2026-11-30");
  // 10000 + 1500 commission − 10 % of 11500
  assert.equal(r.total, 10350);
  assert.equal(proRated(p, 30, 30).fix_salary, 20000);
  assert.equal(proRated(p, 0, 30).fix_salary, 0);
});
