import { test } from "node:test";
import assert from "node:assert/strict";
import { groupPhone, isProbableTypo, phone10 } from "./phone";
import { bucketOf, compareQueue, type QueueLead } from "./queue";
import { DEFAULT_CODES, nextState, outcomeSchema, retryAt, validateOutcome, type OutcomeInput } from "./rules";

test("phone10 normalisation", () => {
  assert.equal(phone10("09465658112"), "9465658112");
  assert.equal(phone10("+91 94656 58112"), "9465658112");
  assert.equal(phone10("919465658112"), "9465658112");
  assert.equal(phone10(""), null);
  assert.equal(phone10("Unknown"), null);
  assert.equal(phone10(null), null);
  assert.equal(groupPhone("9465658112"), "94656 58112");
});

test("probable typo: one digit off or one adjacent swap, nothing else", () => {
  assert.equal(isProbableTypo("9465658112", "9465658113"), true);   // last digit
  assert.equal(isProbableTypo("9465658112", "9465658121"), true);   // adjacent swap
  assert.equal(isProbableTypo("9465658112", "9465658112"), false);  // same
  assert.equal(isProbableTypo("9465658112", "9465658221"), false);  // two digits
  assert.equal(isProbableTypo("9465658112", "1465658119"), false);  // non-adjacent swap-ish
  assert.equal(isProbableTypo("9465658112", "946565811"), false);   // length
});

test("queue order: due now, overdue (oldest), new (newest), retries due, everything else", () => {
  const now = new Date("2026-11-06T12:00:00Z");
  const m = (min: number) => new Date(now.getTime() + min * 60_000);
  const L = (name: string, status: string, follow: number | null, created: number): QueueLead & { name: string } =>
    ({ name, status, next_followup_at: follow === null ? null : m(follow), created_at: m(created) });
  const leads = [
    L("later-callback", "callback", 120, -900),
    L("retry-waiting", "retry", 30, -800),
    L("new-old", "new", null, -600),
    L("overdue-recent", "callback", -20, -700),
    L("due-in-10", "callback", 10, -500),
    L("retry-due", "retry", -60, -400),
    L("new-fresh", "new", null, -5),
    L("overdue-oldest", "callback", -300, -700),
    L("due-5-ago", "callback", -5, -500),
  ];
  const order = [...leads].sort((a, b) => compareQueue(a, b, now)).map((l) => l.name);
  assert.deepEqual(order, [
    "due-5-ago", "due-in-10",            // due now, soonest first
    "overdue-oldest", "overdue-recent",  // overdue, oldest first
    "new-fresh", "new-old",              // new, newest first
    "retry-due",
    "retry-waiting", "later-callback",   // everything else
  ]);
  assert.equal(bucketOf(L("edge", "callback", 15, 0), now), "due_now");   // exactly 15 min before
  assert.equal(bucketOf(L("edge", "callback", 16, 0), now), "later");
});

const base = (o: Partial<OutcomeInput>): OutcomeInput => outcomeSchema.parse({ version: 1, code: "A", ...o });

test("D/E/F validation", () => {
  const now = new Date("2026-11-06T12:00:00Z");
  const later = "2026-11-06T18:30:00+05:30";
  const note = "Asked to call back at 6:30 PM";
  assert.equal(validateOutcome(base({ code: "D", note, callback_at: later }), now), null);  // reason is optional now
  assert.match(validateOutcome(base({ code: "D", reason: "Busy", note: "too short", callback_at: later }), now)!, /15 characters/);
  assert.match(validateOutcome(base({ code: "E", reason: "Salary", note }), now)!, /callback/);
  assert.match(validateOutcome(base({ code: "D", reason: "Busy", note, callback_at: "2026-11-06T10:00:00Z" }), now)!, /past/);
  assert.equal(validateOutcome(base({ code: "D", reason: "Busy", note, callback_at: later }), now), null);
  assert.equal(validateOutcome(base({ code: "F", note }), now), null);
  assert.equal(validateOutcome(base({ code: "F", reason: "Paid on UPI", note: "Paid 299 on UPI during the call" }), now), null);
  assert.equal(validateOutcome(base({ code: "B" }), now), null);  // retries need nothing
  assert.equal(validateOutcome(base({ code: "G" }), now), null);
  assert.match(validateOutcome(base({ code: "H" }), now)!, /not in use/); // codes marked "Not used" in settings
  assert.equal(outcomeSchema.safeParse({ version: 1, code: "AB" }).success, false); // one capital letter only
});

test("next state: retry waits, drop after 6 failed attempts or an invalid number, F defaults to 299", () => {
  const now = new Date("2026-11-06T12:00:00Z"); // 17:30 IST
  const rules = { A: { hours: 6 }, B: { hours: 3 }, C: { next_day_at: "10:00" }, invalid: { never: true }, max_attempts: 6 };
  assert.deepEqual(nextState(0, base({ code: "B" }), rules, now).next_followup_at, new Date("2026-11-06T15:00:00Z"));
  // A time the rep picked beats the automatic retry
  assert.deepEqual(nextState(0, base({ code: "B", callback_at: "2026-11-07T06:00:00Z" }), rules, now).next_followup_at, new Date("2026-11-07T06:00:00Z"));
  assert.deepEqual(retryAt(rules.C, now), new Date("2026-11-07T04:30:00Z")); // 10:00 IST next day
  assert.equal(nextState(4, base({ code: "A" }), rules, now).status, "retry");
  assert.equal(nextState(5, base({ code: "A" }), rules, now).status, "dropped");
  assert.equal(nextState(0, base({ code: "A", reason: "Invalid number" }), rules, now).status, "dropped");
  // 0 = never drop (the client's choice): the 50th "no contact" is still a retry
  assert.equal(nextState(49, base({ code: "A" }), { max_attempts: 0 }, now).status, "retry");
  const f = nextState(3, base({ code: "F", reason: "UPI", note: "Paid 299 on the call today" }), rules, now);
  assert.equal(f.status, "converted");
  assert.equal(f.amount, 299);
  assert.equal(f.attempts, 0);
  assert.equal(nextState(2, base({ code: "G" }), rules, now).status, "dnc");
  // "Other": follow-up only when the rep set one; no note or time required
  const codes = { ...DEFAULT_CODES, X: { label: "Demo booked", role: "other" as const, description: "Free demo class booked" } };
  assert.equal(validateOutcome(base({ code: "X" }), now, codes), null);
  assert.deepEqual(nextState(0, base({ code: "X" }), rules, now, codes).next_followup_at, null);
  assert.deepEqual(nextState(0, base({ code: "X", callback_at: "2026-11-07T06:00:00Z" }), rules, now, codes).next_followup_at, new Date("2026-11-07T06:00:00Z"));
});
