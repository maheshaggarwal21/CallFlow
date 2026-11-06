import { test } from "node:test";
import assert from "node:assert/strict";
import { DATED_KEY, planDeletions, type RetentionPlanInput } from "./retentionPlan";

// The selection logic exactly as it was in retention.ts before keep_audio existed.
function legacyPlan(objectKeys: string[], oldKeysIn: string[], newKeys: string[], cutoffDay: string) {
  const sizeOf = new Map(objectKeys.map((k) => [k, 1]));
  const protectedKeys = new Set<string>(newKeys);
  const oldRowKeys = new Set<string>(oldKeysIn);
  const toDelete = new Set<string>();
  for (const key of oldRowKeys) if (sizeOf.has(key)) toDelete.add(key);
  for (const key of objectKeys) {
    const m = DATED_KEY.exec(key);
    if (m && m[1] < cutoffDay) toDelete.add(key);
  }
  for (const key of protectedKeys) toDelete.delete(key);
  const dangling = [...oldRowKeys].filter((k) => !sizeOf.has(k) && !protectedKeys.has(k));
  return { keys: [...toDelete].sort(), dangling };
}

// Deterministic pseudo-random bucket + call rows covering every branch.
function randomCase(seed: number) {
  let s = seed;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const day = (d: number) => `202608${String(d).padStart(2, "0")}`;
  const key = (d: number, n: number) => `korecall/202608/${day(d)}/${n}.webm`;
  const objectKeys: string[] = [], oldKeys: string[] = [], newKeys: string[] = [];
  for (let n = 0; n < 300; n++) {
    const d = 1 + Math.floor(rnd() * 28), k = key(d, n), r = rnd();
    if (r < 0.85) objectKeys.push(k);                       // object exists (15% dangling links)
    if (rnd() < 0.7) (d < 15 && rnd() < 0.9 ? oldKeys : newKeys).push(k); // referenced by a call; some clock-fixed
  }
  objectKeys.push("korecall/garbage.txt", "other/202608/20260801/x.wav");
  return { objectKeys, oldKeys, newKeys, cutoffDay: day(15) };
}

test("planDeletions matches the old logic when no call has keep_audio", () => {
  for (let seed = 1; seed <= 50; seed++) {
    const c = randomCase(seed);
    const input: RetentionPlanInput = {
      objectKeys: c.objectKeys,
      oldRows: c.oldKeys.map((key) => ({ key, keep: false })),
      newRows: c.newKeys.map((key) => ({ key, keep: false })),
      cutoffDay: c.cutoffDay,
    };
    const got = planDeletions(input);
    const want = legacyPlan(c.objectKeys, c.oldKeys, c.newKeys, c.cutoffDay);
    assert.deepEqual(got.keys, want.keys, `keys differ for seed ${seed}`);
    assert.deepEqual(got.dangling.sort(), want.dangling.sort(), `dangling differ for seed ${seed}`);
    assert.ok(got.keys.length > 0, "the case should delete something");
  }
});

test("keep_audio protects old calls in both delete passes and from link clearing", () => {
  const old = "korecall/202605/20260501/kept.webm";       // old call row + old dated folder
  const oldGone = "korecall/202605/20260502/kept-gone.webm"; // kept, but object already missing
  const plain = "korecall/202605/20260503/plain.webm";
  const plan = planDeletions({
    objectKeys: [old, plain],
    oldRows: [{ key: old, keep: true }, { key: oldGone, keep: true }, { key: plain, keep: false }],
    newRows: [],
    cutoffDay: "20260801",
  });
  assert.deepEqual(plan.keys, [plain]);       // pass 1 and the dated-folder pass both skip `old`
  assert.deepEqual(plan.dangling, []);        // a kept call's link is never cleared
});
