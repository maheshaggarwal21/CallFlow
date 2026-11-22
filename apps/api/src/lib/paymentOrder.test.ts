import { test } from "node:test";
import assert from "node:assert/strict";
import { byPaidThenEntered } from "./paymentOrder";

test("payments: paid date first, then newest entry, no-time last, same order whatever the arrival order", () => {
  const rows = [
    { id: "a", paidDate: "2026-11-21", createdAt: "2026-11-21T10:00:00+05:30" },
    { id: "b", paidDate: "2026-11-21", createdAt: "2026-11-21T15:00:00+05:30" },
    { id: "c", paidDate: "2026-11-20", createdAt: "2026-11-21T16:00:00+05:30" }, // late UPI upload: stays on the 20th
    { id: "d", paidDate: "2026-11-21", createdAt: null },
    { id: "e", paidDate: "2026-11-21", createdAt: "2026-11-21T15:00:00+05:30" },
  ];
  const want = ["b", "e", "a", "d", "c"];
  assert.deepEqual([...rows].sort(byPaidThenEntered).map((r) => r.id), want);
  assert.deepEqual([...rows].reverse().sort(byPaidThenEntered).map((r) => r.id), want);
});
