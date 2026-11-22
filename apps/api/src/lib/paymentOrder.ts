// Payments tab order (client, 22 Nov 2026): newest paid date first; within a day, the newest entry first (Razorpay's
// webhook or the UPI upload time); payments the school site sent no entry time for go last in their day.
// A late UPI upload keeps its paid date's place instead of jumping to the top. The id breaks the last ties, so the
// order never depends on which rep's answer came back first.
type P = { paidDate: string; createdAt: string | null; id: string };
export function byPaidThenEntered(a: P, b: P): number {
  if (a.paidDate !== b.paidDate) return a.paidDate < b.paidDate ? 1 : -1;
  const ta = a.createdAt ? Date.parse(a.createdAt) : -Infinity, tb = b.createdAt ? Date.parse(b.createdAt) : -Infinity;
  if (ta !== tb) return tb - ta > 0 ? 1 : -1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
