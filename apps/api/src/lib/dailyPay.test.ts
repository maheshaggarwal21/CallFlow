// Daily salary rules — docs/salary-commission/EMPLOYEE-PAYMENT-FLOW.md. Run: npm run build && node --test dist/lib/dailyPay.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { dailySalary, dayPaise, dayShare, extrasAndDeductions, isoWeekday, monthDays, stepQuarters, workingDaysOf, type DayTargets, type PayDayInput, type PayPlan } from "./payroll";

const T = (o: Partial<DayTargets> = {}): DayTargets => ({
  target_call_secs: 6 * 3600, target_trial: 2, target_regular: 4, tick_call: true, tick_trial: true, tick_regular: true, ...o,
});
const plan: PayPlan = { fix_salary: 12000, trial_commission: 0, trial_commission_type: "fix", regular_commission: 0, regular_commission_type: "fix" };

test("steps: below 50 % → 0, 50 % → ½, 75 % → ¾, 100 % or more → full (exact edges)", () => {
  assert.equal(stepQuarters(0, 4), 0);
  assert.equal(stepQuarters(1, 4), 0);          // 25 %
  assert.equal(stepQuarters(2, 4), 2);          // 50 %
  assert.equal(stepQuarters(3, 4), 3);          // 75 %
  assert.equal(stepQuarters(4, 4), 4);          // 100 %
  assert.equal(stepQuarters(9, 4), 4);          // 225 %: capped, nothing extra
  assert.equal(stepQuarters(10799, 21600), 0);  // 49.995 % of 6 h
  assert.equal(stepQuarters(10800, 21600), 2);  // exactly 3 h
  assert.equal(stepQuarters(16199, 21600), 2);  // a second short of 75 %
  assert.equal(stepQuarters(16200, 21600), 3);  // exactly 4 h 30
  assert.equal(stepQuarters(21599, 21600), 3);  // a second short of 6 h
  assert.equal(stepQuarters(21600, 21600), 4);
  assert.equal(stepQuarters(1, 2), 2);          // a target of 2: only 0 %, 50 %, 100 % are possible
  assert.equal(stepQuarters(2, 3), 2);          // 67 % → ½
});

test("each ticked target is an equal share; none ticked = full day; a ticked 0 target is ignored", () => {
  // the document's example: calling 100 %, trials 50 %, regular 0 % → (4 + 2 + 0) / 12 = ½
  const s = dayShare(T(), { call_secs: 6 * 3600, trial: 1, regular: 0 });
  assert.deepEqual([s.num, s.den], [6, 12]);
  assert.deepEqual(s.parts.map((p) => p.quarters), [4, 2, 0]);
  assert.deepEqual([dayShare(T({ tick_call: false, tick_trial: false, tick_regular: false }), { call_secs: 0, trial: 0, regular: 0 }).num,
    dayShare(T({ tick_call: false, tick_trial: false, tick_regular: false }), { call_secs: 0, trial: 0, regular: 0 }).den], [1, 1]);
  // two ticked: 100 % and 50 % → ¾ of the day
  const two = dayShare(T({ tick_regular: false }), { call_secs: 6 * 3600, trial: 1, regular: 0 });
  assert.deepEqual([two.num, two.den], [6, 8]);
  // a ticked target set to 0 doesn't count; the rest decide
  const zero = dayShare(T({ target_trial: 0, tick_regular: false }), { call_secs: 3 * 3600, trial: 0, regular: 0 });
  assert.deepEqual([zero.num, zero.den, zero.parts.length], [2, 4, 1]);
  // "count as full" wins
  assert.deepEqual([dayShare(T(), { call_secs: 0, trial: 0, regular: 0 }, true).num, dayShare(T(), { call_secs: 0, trial: 0, regular: 0 }, true).den], [1, 1]);
});

test("day salary: fix ÷ working days × share, rounded once to the paisa", () => {
  assert.equal(dayPaise(12000, 1, 1, 25), 48000);          // ₹480 a day
  assert.equal(dayPaise(12000, 6, 12, 25), 24000);         // the example: ₹240
  assert.equal(dayPaise(12000, 3, 12, 26), 11538);         // ¼ of ₹461.538… → ₹115.38
  assert.equal(dayPaise(12000, 1, 1, 0), 0);               // no working days: nothing, no crash
});

test("calendar: ISO weekdays, month days, working days without Sundays and holidays", () => {
  assert.equal(isoWeekday("2026-11-15"), 7);   // a Sunday
  assert.equal(isoWeekday("2026-11-16"), 1);   // Monday
  assert.equal(monthDays("2028-02").length, 29);
  const nov = workingDaysOf("2026-11", [1, 2, 3, 4, 5, 6], new Set());
  assert.equal(nov.length, 25);                // November 2026: 30 days, 5 Sundays
  assert.equal(workingDaysOf("2026-11", [1, 2, 3, 4, 5, 6], new Set(["2026-11-14", "2026-11-15"])).length, 24); // a Sunday holiday changes nothing
});

test("extras and deductions: once in the start month, up to today; % of the full fixed salary", () => {
  const p: PayPlan = { ...plan, extra_commissions: [{ name: "Bonus", amount: 500, from: "2026-11-05", to: "2026-11-30" }, { name: "Later", amount: 900, from: "2026-11-20", to: "2026-11-25" }],
    extra_deductions: [{ name: "Late", type: "pct", amount: 10, from: "2026-11-02", to: "2026-11-02" }] };
  const so = extrasAndDeductions(p, "2026-11-01", "2026-11-15");
  assert.deepEqual(so.extras, [{ name: "Bonus", amount: 500 }]);       // "Later" starts after today: not yet
  assert.deepEqual(so.deductions, [{ name: "Late", amount: 1200 }]);   // 10 % of ₹12,000, not of the salary earned so far
});

test("a month: working, away (before joining / switched off), holidays, Sundays, future days, count-as-full", () => {
  const holidays = new Map([["2026-11-11", "Diwali"]]);
  const wd = [1, 2, 3, 4, 5, 6];
  const W = workingDaysOf("2026-11", wd, holidays).length;             // 24
  const done = { call_secs: 6 * 3600, trial: 2, regular: 4 };
  const input = new Map<string, PayDayInput>();
  for (const day of monthDays("2026-11")) input.set(day, { day, targets: day >= "2026-11-03" ? T() : null, done, countAsFull: false });
  input.set("2026-11-04", { day: "2026-11-04", targets: T(), done: { call_secs: 3 * 3600, trial: 1, regular: 3 }, countAsFull: false }); // ½ ½ ¾ → 7/12
  input.set("2026-11-05", { day: "2026-11-05", targets: T(), done: { call_secs: 0, trial: 0, regular: 0 }, countAsFull: true });
  const r = dailySalary(plan, "2026-11", "2026-11-12", wd, holidays, input);
  assert.equal(r.working_days, W);
  assert.equal(W, 24);
  const k = (d: string) => r.days.find((x) => x.day === d)!;
  assert.equal(k("2026-11-02").kind, "away");      // before joining: no pay
  assert.equal(k("2026-11-08").kind, "off");       // Sunday
  assert.equal(k("2026-11-11").kind, "holiday");
  assert.equal(k("2026-11-11").holiday, "Diwali");
  assert.equal(k("2026-11-13").kind, "future");    // after today
  assert.equal(k("2026-11-04").paise, dayPaise(12000, 7, 12, W));
  assert.equal(k("2026-11-05").paise, dayPaise(12000, 1, 1, W));    // counted as full
  // the month total is exactly the sum of the days shown (no rounding drift between the list and the total)
  assert.equal(r.salary_paise, r.days.reduce((t, d) => t + d.paise, 0));
  // working days so far: 2 Nov–12 Nov without Sunday 8 Nov and the 11 Nov holiday = 9 (1 Nov is a Sunday)
  assert.equal(r.days_so_far, 9);
  // full days 3, 6, 7, 9, 10, 12 = 6 full + 7/12 + 1 (count as full) = 7.5833 days of ₹500
  const full = dayPaise(12000, 1, 1, W);
  assert.equal(r.salary_paise, 7 * full + dayPaise(12000, 7, 12, W));
});
