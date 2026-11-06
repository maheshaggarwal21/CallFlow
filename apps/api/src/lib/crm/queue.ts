/**
 * Lead queue order, computed on the server with the server's clock:
 *   1. Due now — callback within 15 min either side of its time (blinks)
 *   2. Overdue callbacks — oldest first
 *   3. New, never called — newest first
 *   4. Retries whose wait has passed — longest waiting first
 *   5. Everything else — soonest follow-up first
 */
export const DUE_WINDOW_MS = 15 * 60_000;

export type QueueBucket = "due_now" | "overdue" | "new" | "retry" | "later";
export const BUCKET_ORDER: QueueBucket[] = ["due_now", "overdue", "new", "retry", "later"];

export type QueueLead = { status: string; next_followup_at: Date | null; created_at: Date };

export function bucketOf(l: QueueLead, now: Date): QueueBucket {
  const t = now.getTime();
  const due = l.next_followup_at?.getTime() ?? null;
  if (l.status === "callback" && due !== null) {
    if (t >= due + DUE_WINDOW_MS) return "overdue";
    return t >= due - DUE_WINDOW_MS ? "due_now" : "later";
  }
  if (l.status === "new") return "new";
  if (l.status === "retry" && (due === null || due <= t)) return "retry";
  return "later";
}

export function compareQueue(a: QueueLead, b: QueueLead, now: Date): number {
  const ba = BUCKET_ORDER.indexOf(bucketOf(a, now));
  const bb = BUCKET_ORDER.indexOf(bucketOf(b, now));
  if (ba !== bb) return ba - bb;
  if (BUCKET_ORDER[ba] === "new") return b.created_at.getTime() - a.created_at.getTime();
  const da = a.next_followup_at?.getTime() ?? Infinity;
  const db = b.next_followup_at?.getTime() ?? Infinity;
  return da - db || b.created_at.getTime() - a.created_at.getTime();
}
