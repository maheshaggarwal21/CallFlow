import { test } from "node:test";
import assert from "node:assert/strict";
import { findTestCall, sameNumber, maskPhone, randomTestNumber, TEST_MIN_SECS } from "./lineTest";

const t0 = new Date("2026-11-28T04:00:00Z");
const at = (s: number) => new Date(t0.getTime() + s * 1000);
const call = (id: string, line: string, phone: string, secs: number, arrived: number) =>
  ({ id, line_number: line, caller_phone: phone, duration_secs: secs, created_at: at(arrived) });

test("numbers match on their last 10 digits", () => {
  assert.equal(sameNumber("09876543210", "+91 98765 43210"), true);
  assert.equal(sameNumber("01722345678", "1722345678"), true);
  assert.equal(sameNumber("9876543210", "9876543211"), false);
  assert.equal(sameNumber("", ""), false);
  assert.equal(sameNumber("12345", "12345"), false); // too short to trust
});

test("the test call on the picked line connects; short, early or other-number calls don't", () => {
  const calls = [
    call("early", "05", "9876543210", 30, -5),          // arrived before the test began
    call("short", "05", "9876543210", TEST_MIN_SECS - 1, 20),
    call("other", "05", "9000000000", 40, 25),          // a real lead call
    call("hit", "05", "09876543210", 12, 60),
  ];
  const r = findTestCall("05", "9876543210", t0, calls);
  assert.equal(r.hit?.id, "hit");
  assert.equal(r.elsewhere, null);
});

test("a test call on another line means the phone is wired there", () => {
  const r = findTestCall("05", "9876543210", t0, [call("x", "06", "9876543210", 15, 30)]);
  assert.equal(r.hit, null);
  assert.equal(r.elsewhere?.line_number, "06");
});

test("phone masked to first two and last two digits", () => {
  assert.equal(maskPhone("9812345666"), "98******66");
  assert.equal(maskPhone("+91 98123 45666"), "98******66");
  assert.equal(maskPhone(null), "");
});

test("the test number is 10 digits, starts 6-9 and differs each time", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 200; i++) {
    const n = randomTestNumber();
    assert.match(n, /^[6-9]\d{9}$/);
    seen.add(n);
  }
  assert.ok(seen.size > 195);
});
