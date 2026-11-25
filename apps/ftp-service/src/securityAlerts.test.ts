import { test } from "node:test";
import assert from "node:assert/strict";
import { SecurityAlerts, MIN_GAP_MS } from "./securityAlerts";

test("first event mails at once; later ones wait for the hour and come together, counted", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const sent: { subject: string; text: string }[] = [];
  const a = new SecurityAlerts(async (subject, text) => { sent.push({ subject, text }); });

  a.event("block:9.9.9.9", "Blocked 9.9.9.9 after 10 wrong FTP logins (locked out for 1 hour)");
  t.mock.timers.tick(0); await Promise.resolve(); await Promise.resolve();
  assert.equal(sent.length, 1);
  assert.match(sent[0].subject, /guessing blocked/);

  for (let i = 0; i < 300; i++) a.event("worm:1.2.3.4", "Logged in with the correct FTP login from 1.2.3.4 and uploaded files that aren't recordings (e.g. AV.scr)");
  a.event("block:8.8.8.8", "Blocked 8.8.8.8 after 10 wrong FTP logins (locked out for 1 hour)");
  t.mock.timers.tick(MIN_GAP_MS - 1); await Promise.resolve();
  assert.equal(sent.length, 1); // not yet: once an hour at most
  t.mock.timers.tick(1); await Promise.resolve(); await Promise.resolve();
  assert.equal(sent.length, 2);
  assert.match(sent[1].subject, /SECURITY: someone outside/);
  assert.match(sent[1].text, /300 times/);
  assert.match(sent[1].text, /8\.8\.8\.8/);
});
