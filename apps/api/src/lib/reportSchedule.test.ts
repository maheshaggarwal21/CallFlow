// Run: npm run build && node --test dist/lib/reportSchedule.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { dueSendAt, reportWindow } from "./reportSchedule";

const ist = (s: string) => new Date(`${s}+05:30`);
const daily = { frequency: "daily" as const, send_time: "19:00:00", weekday: null };

test("daily: due from send time for one hour, not before or after", () => {
  assert.equal(dueSendAt(daily, ist("2026-11-02T18:59:59")), null);
  assert.deepEqual(dueSendAt(daily, ist("2026-11-02T19:00:00")), ist("2026-11-02T19:00:00"));
  assert.deepEqual(dueSendAt(daily, ist("2026-11-02T19:59:00")), ist("2026-11-02T19:00:00"));
  assert.equal(dueSendAt(daily, ist("2026-11-02T20:00:00")), null);
});

test("uses IST, not the server's UTC date", () => {
  // 00:10 IST on Nov 3 is still Nov 2 in UTC
  const s = { ...daily, send_time: "00:05:00" };
  assert.deepEqual(dueSendAt(s, ist("2026-11-03T00:10:00")), ist("2026-11-03T00:05:00"));
});

test("weekly only on its weekday", () => {
  const s = { frequency: "weekly" as const, send_time: "19:00:00", weekday: 1 }; // Monday
  assert.ok(dueSendAt(s, ist("2026-11-02T19:10:00")));   // Mon
  assert.equal(dueSendAt(s, ist("2026-11-03T19:10:00")), null); // Tue
});

test("monthly only on the last day of the month", () => {
  const s = { frequency: "monthly" as const, send_time: "19:00:00", weekday: null };
  assert.ok(dueSendAt(s, ist("2026-11-30T19:10:00")));
  assert.equal(dueSendAt(s, ist("2026-11-29T19:10:00")), null);
  assert.ok(dueSendAt(s, ist("2028-02-29T19:10:00"))); // leap year
});

test("windows", () => {
  const at = ist("2026-11-02T19:00:00");
  const d = reportWindow("daily", at);
  assert.deepEqual([d.start, d.end, d.label, d.periodKey], [ist("2026-11-02T00:00:00"), at, "02 Nov 2026", "2026-11-02"]);
  const w = reportWindow("weekly", at);
  assert.deepEqual([w.start, w.label], [ist("2026-10-27T00:00:00"), "27 Oct 2026 – 02 Nov 2026"]);
  const m = reportWindow("monthly", at);
  assert.deepEqual([m.start, m.label], [ist("2026-11-01T00:00:00"), "November 2026"]);
});
