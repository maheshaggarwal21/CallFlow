import { test } from "node:test";
import assert from "node:assert/strict";
import { LoginGuard, MAX_FAILS, WINDOW_MS, BLOCK_MS, TRUST_MS, plainIp } from "./loginGuard";

test("a guesser is blocked after MAX_FAILS wrong logins in the window, for BLOCK_MS", () => {
  const g = new LoginGuard();
  for (let i = 1; i < MAX_FAILS; i++) assert.equal(g.failed("9.9.9.9", i), false);
  assert.equal(g.isBlocked("9.9.9.9", MAX_FAILS), false);
  assert.equal(g.failed("9.9.9.9", MAX_FAILS), true);
  assert.equal(g.isBlocked("9.9.9.9", MAX_FAILS + 1), true);
  assert.equal(g.isBlocked("9.9.9.9", MAX_FAILS + BLOCK_MS), false); // block ends
  assert.equal(g.isBlocked("8.8.8.8", 0), false);                    // others untouched
});

test("slow guessing (spread beyond the window) is not a block", () => {
  const g = new LoginGuard();
  for (let i = 0; i < MAX_FAILS * 2; i++) assert.equal(g.failed("9.9.9.9", i * (WINDOW_MS / (MAX_FAILS - 1) + 1)), false);
});

test("an office address that delivered a recording is never blocked, even with a wrong password", () => {
  const g = new LoginGuard();
  g.delivered("1.2.3.4", 0);
  for (let i = 0; i < MAX_FAILS * 3; i++) assert.equal(g.failed("1.2.3.4", 1000 + i), false);
  assert.equal(g.isBlocked("1.2.3.4", 2000), false);
  // trust lasts TRUST_MS; after that it is an unknown address again
  for (let i = 0; i < MAX_FAILS - 1; i++) g.failed("1.2.3.4", TRUST_MS + i);
  assert.equal(g.failed("1.2.3.4", TRUST_MS + MAX_FAILS), true);
  // a recording from it lifts the block at once
  g.delivered("1.2.3.4", TRUST_MS + MAX_FAILS + 1);
  assert.equal(g.isBlocked("1.2.3.4", TRUST_MS + MAX_FAILS + 2), false);
});

test("IPv4-mapped addresses are the same client", () => {
  assert.equal(plainIp("::ffff:39.105.1.2"), "39.105.1.2");
  assert.equal(plainIp("39.105.1.2"), "39.105.1.2");
});
