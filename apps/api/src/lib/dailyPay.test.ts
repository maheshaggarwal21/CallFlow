// Daily salary rules — docs/salary-commission/EMPLOYEE-PAYMENT-FLOW.md. Run: npm run build && node --test dist/lib/dailyPay.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { dailySalary, dayPaise, dayShare, extrasAndDeductions, isoWeekday, monthDays, stepQuarters, workingDaysOf, type DayTargets, type PayDayInput, type PayPlan } from "./payroll";

const T = (o: Partial<DayTargets> = {}): DayTargets => ({
  target_call_secs: 6 * 3600, target_trial: 2, target_regular: 4, tick_call: true, tick_trial: true, tick_regular: true, ...o,
});
const plan: PayPlan = { fix_salary: 12000, trial_commission: 0, trial_commission_type: "fix", regular_commission: 0, regular_commission_type: "fix" };

test("steps (client, 17 Nov 2026: no 75 % step): below 50 % → 0, 50 % to under 100 % → ½, 100 % → full", () => {
  assert.equal(stepQuarters(0, 4), 0);
  assert.equal(stepQuarters(1, 4), 0);          // 25 %
  assert.equal(stepQuarters(2, 4), 2);          // 50 %
  assert.equal(stepQuarters(3, 4), 2);          // 75 %: still ½ (the ¾ step is gone)
  assert.equal(stepQuarters(4, 4), 4);          // 100 %
  assert.equal(stepQuarters(9, 4), 4);          // 225 %: capped, nothing extra
  assert.equal(stepQuarters(10799, 21600), 0);  // 49.995 % of 6 h
  assert.equal(stepQuarters(10800, 21600), 2);  // exactly 3 h
  assert.equal(stepQuarters(21599, 21600), 2);  // a second short of 6 h
  assert.equal(stepQuarters(21600, 21600), 4);
  assert.equal(stepQuarters(1, 2), 2);          // a target of 2: 0 %, 50 %, 100 %
});

test("the day (client, 17 Nov 2026): calling and trial only; ANY target met → full day, else the best step", () => {
  const share = (o: Partial<DayTargets>, d: { call_secs: number; trial: number; regular?: number }, full = false) => {
    const s = dayShare(T(o), { regular: 0, ...d }, full); return [s.num, s.den];
  };
  assert.deepEqual(share({}, { call_secs: 6 * 3600, trial: 0 }), [4, 4]);         // calling met, no trial → full day
  assert.deepEqual(share({}, { call_secs: 0, trial: 2 }), [4, 4]);                // trial met, no calling → full day
  assert.deepEqual(share({}, { call_secs: 3 * 3600, trial: 0 }), [2, 4]);         // best is calling 50 % → ½ day
  assert.deepEqual(share({}, { call_secs: 3 * 3600, trial: 1 }), [2, 4]);         // both 50 % → ½ day (not added up)
  assert.deepEqual(share({}, { call_secs: 3600, trial: 0 }), [0, 4]);             // both under 50 % → ₹0
  assert.deepEqual(share({}, { call_secs: 5 * 3600, trial: 1 }), [2, 4]);         // 83 % and 50 % → ½ (no ¾ any more)
  // the regular-joining target no longer counts, even if still ticked on an old saved day
  const old = dayShare(T(), { call_secs: 0, trial: 0, regular: 99 });
  assert.deepEqual([old.num, old.den, old.parts.map((p) => p.key).join()], [0, 4, "call,trial"]);
  // only one ticked: that one decides; none ticked (or a 0 target) → full day; count as full → full day
  assert.deepEqual(share({ tick_trial: false }, { call_secs: 3 * 3600, trial: 5 }), [2, 4]);
  assert.deepEqual(share({ tick_call: false, tick_trial: false }, { call_secs: 0, trial: 0 }), [1, 1]);
  assert.deepEqual(share({ target_trial: 0, target_call_secs: 0 }, { call_secs: 0, trial: 0 }), [1, 1]);
  assert.deepEqual(share({}, { call_secs: 0, trial: 0 }, true), [1, 1]);
});

test("day salary: fix ÷ working days × share, rounded once to the paisa", () => {
  assert.equal(dayPaise(12000, 1, 1, 25), 48000);          // ₹480 a day
  assert.equal(dayPaise(12000, 2, 4, 25), 24000);          // half a day: ₹240
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

test("extras and deductions: once in the start month, up to today; % of salary + commission earned so far", () => {
  const p: PayPlan = { ...plan, extra_commissions: [{ name: "Bonus", amount: 500, from: "2026-11-05", to: "2026-11-30" }, { name: "Later", amount: 900, from: "2026-11-20", to: "2026-11-25" }],
    extra_deductions: [{ name: "Late", type: "pct", amount: 10, from: "2026-11-02", to: "2026-11-02" }] };
  // ₹5,280 salary so far + ₹220 commission
  const so = extrasAndDeductions(p, "2026-11-01", "2026-11-15", 5500);
  assert.deepEqual(so.extras, [{ name: "Bonus", amount: 500 }]);       // "Later" starts after today: not yet
  assert.deepEqual(so.deductions, [{ name: "Late", amount: 550 }]);    // 10 % of ₹5,500 (the ₹500 extra left out), not of the fixed ₹12,000
});

test("a month: working, away (before joining / switched off), holidays, Sundays, future days, count-as-full", () => {
  const holidays = new Map([["2026-11-11", "Diwali"]]);
  const wd = [1, 2, 3, 4, 5, 6];
  const W = workingDaysOf("2026-11", wd, holidays).length;             // 24
  const done = { call_secs: 6 * 3600, trial: 2, regular: 4 };
  const input = new Map<string, PayDayInput>();
  for (const day of monthDays("2026-11")) input.set(day, { day, targets: day >= "2026-11-03" ? T() : null, done, countAsFull: false });
  input.set("2026-11-04", { day: "2026-11-04", targets: T(), done: { call_secs: 3 * 3600, trial: 1, regular: 3 }, countAsFull: false }); // both 50 % → ½ day
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
  assert.equal(k("2026-11-04").paise, dayPaise(12000, 2, 4, W));
  assert.equal(k("2026-11-05").paise, dayPaise(12000, 1, 1, W));    // counted as full
  // the month total is exactly the sum of the days shown (no rounding drift between the list and the total)
  assert.equal(r.salary_paise, r.days.reduce((t, d) => t + d.paise, 0));
  // working days so far: 2 Nov–12 Nov without Sunday 8 Nov and the 11 Nov holiday = 9 (1 Nov is a Sunday)
  assert.equal(r.days_so_far, 9);
  // full days 3, 6, 7, 9, 10, 12 = 6 full + ½ (the 4th) + 1 (count as full) = 7.5 days of ₹500
  const full = dayPaise(12000, 1, 1, W);
  assert.equal(r.salary_paise, 7 * full + dayPaise(12000, 2, 4, W));
});
