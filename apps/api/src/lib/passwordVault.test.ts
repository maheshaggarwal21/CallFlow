// Run: npm run build && node --test dist/lib/passwordVault.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { open, seal, vaultConfigured } from "./passwordVault";

const KEY = "a".repeat(64);
const withKey = (k: string | undefined, f: () => void) => {
  const old = process.env.PASSWORD_VIEW_KEY;
  if (k === undefined) delete process.env.PASSWORD_VIEW_KEY; else process.env.PASSWORD_VIEW_KEY = k;
  try { f(); } finally { if (old === undefined) delete process.env.PASSWORD_VIEW_KEY; else process.env.PASSWORD_VIEW_KEY = old; }
};

test("a password round-trips and the stored copy doesn't contain it", () => withKey(KEY, () => {
  const s = seal("Max@1234")!;
  assert.ok(s.startsWith("v1:") && !s.includes("Max@1234") && !Buffer.from(s.slice(3), "base64").includes("Max@1234"));
  assert.equal(open(s), "Max@1234");
}));

test("the same password seals differently each time (random IV)", () => withKey(KEY, () => {
  assert.notEqual(seal("same"), seal("same"));
}));

test("no key: nothing is stored and nothing opens", () => {
  let s = "";
  withKey(KEY, () => { s = seal("x")!; });
  withKey(undefined, () => { assert.equal(vaultConfigured(), false); assert.equal(seal("x"), null); assert.equal(open(s), null); });
  withKey("short", () => assert.equal(seal("x"), null));
});

test("a wrong key or an altered copy shows nothing", () => {
  let s = "";
  withKey(KEY, () => { s = seal("secret")!; });
  withKey("b".repeat(64), () => assert.equal(open(s), null));
  withKey(KEY, () => {
    const raw = Buffer.from(s.slice(3), "base64"); raw[raw.length - 1] ^= 1;
    assert.equal(open("v1:" + raw.toString("base64")), null);
    assert.equal(open("garbage"), null);
  });
});
