/**
 * Which R2 objects the retention job deletes, as a pure function so it can be
 * tested without R2 or a database. See retention.ts for the rules.
 */
export const DATED_KEY = /^korecall\/\d{6}\/(\d{8})\//;

export type RetentionRow = { key: string; keep: boolean };

export type RetentionPlanInput = {
  /** Every object under korecall/ in the bucket. */
  objectKeys: string[];
  /** Calls older than the cutoff that still reference an object. */
  oldRows: RetentionRow[];
  /** Calls inside the window that reference an object. */
  newRows: RetentionRow[];
  /** YYYYMMDD (IST) of the cutoff; folders dated before it are expired. */
  cutoffDay: string;
};

export function planDeletions(i: RetentionPlanInput): { keys: string[]; dangling: string[] } {
  const inBucket = new Set(i.objectKeys);
  // Never delete audio a call inside the window still uses, nor audio a call is
  // marked to keep (CRM: matched to a paid / never-call-again lead, or starred).
  const protectedKeys = new Set<string>([
    ...i.newRows.map((r) => r.key),
    ...i.oldRows.filter((r) => r.keep).map((r) => r.key),
  ]);
  const oldKeys = new Set(i.oldRows.filter((r) => !r.keep).map((r) => r.key));

  const toDelete = new Set<string>();
  for (const key of oldKeys) if (inBucket.has(key)) toDelete.add(key);
  for (const key of i.objectKeys) {
    const m = DATED_KEY.exec(key);
    if (m && m[1] < i.cutoffDay) toDelete.add(key);
  }
  for (const key of protectedKeys) toDelete.delete(key);

  // Old rows pointing at an object that is already gone: clear the dead link too
  const dangling = [...oldKeys].filter((k) => !inBucket.has(k) && !protectedKeys.has(k));
  return { keys: [...toDelete].sort(), dangling };
}
