// Runs LeadSync.gs against a fake Apps Script runtime (sheet, properties, lock, triggers, mail,
// UrlFetch) and a fake CRM server. No Google account or network needed:
//   node scripts/apps-script/LeadSync.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const SRC = readFileSync(new URL("./LeadSync.gs", import.meta.url), "utf8");
const HEADER = ["Timestamp", "Name", "Contact", "Email", "Source", "", "Status", "Amount", "Guitar"];
const T0 = Date.parse("2026-11-08T06:00:00Z"); // 11:30 IST

function fmt(d, tz, pat) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).formatToParts(d).map((x) => [x.type, x.value]));
  const mon = new Intl.DateTimeFormat("en-GB", { timeZone: tz, month: "short" }).format(d);
  return pat.replace("yyyy", p.year).replace("MMM", mon).replace("MM", p.month).replace("dd", p.day)
    .replace("HH", p.hour === "24" ? "00" : p.hour).replace("mm", p.minute).replace("ss", p.second);
}
const istStamp = (ms) => fmt(new Date(ms), "Asia/Kolkata", "dd/MM/yyyy HH:mm:ss");
const lead = (i, ms = T0 - 3600e3, phone = String(9100000000 + i)) => [istStamp(ms + i * 1000), `Lead ${i}`, phone, "", "Meta", "Raman", "", 299, ""];

/** A fresh world: sheet rows, script properties, a fake server and recorders. */
function world(rows = [], props = {}) {
  let clock = T0;
  const grid = [HEADER.slice(), ...rows.map((r) => r.slice())];
  const P = { CRM_SECRET: "s".repeat(40), ...props };
  const log = { posts: [], pings: [], mails: [], flushes: 0, events: [] };
  const server = { byId: new Map(), byPhone: new Map(), seq: 100, errorPhones: new Map(), down: 0, missing: new Set() };
  let triggers = [{ fn: "onFormSubmit", owner: "other" }];
  let lockFree = true, mailBroken = false;

  const cellsOf = (r) => grid[r - 1] || (grid[r - 1] = []);
  const lastRow = () => { for (let i = grid.length; i > 0; i--) if ((grid[i - 1] || []).some((c) => String(c ?? "") !== "")) return i; return 0; };
  const range = (r, c, nr = 1, nc = 1) => ({
    getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => cellsOf(r + i)[c - 1 + j] ?? "")),
    setValues: (v) => { v.forEach((row, i) => row.forEach((x, j) => { cellsOf(r + i)[c - 1 + j] = x; })); log.events.push(`write:${r}`); },
    setValue: (x) => { cellsOf(r)[c - 1] = x; log.events.push(`write:${r}`); },
  });
  const sheet = { getLastRow: lastRow, getLastColumn: () => Math.max(...grid.map((r) => r.length)), getRange: range };

  function ingest(rows) {
    return rows.map((row, index) => {
      const p = String(row.phone).replace(/\D/g, "");
      if (p.length !== 10) return { index, external_id: row.external_id, result: "invalid", error: "Phone needs 10 digits" };
      const left = server.errorPhones.get(p);
      if (left) { server.errorPhones.set(p, left - 1); return { index, external_id: row.external_id, result: "error", error: "db hiccup" }; }
      if (server.byId.has(row.external_id)) return { index, external_id: row.external_id, result: "duplicate" };
      if (server.byPhone.has(p)) { server.byId.set(row.external_id, server.byPhone.get(p)); return { index, external_id: row.external_id, result: "reenquired", lead_code: server.byPhone.get(p) }; }
      const code = `LMS-${++server.seq}`;
      server.byId.set(row.external_id, code); server.byPhone.set(p, code);
      return { index, external_id: row.external_id, result: "created", lead_code: code };
    });
  }
  const res = (code, body) => ({ getResponseCode: () => code, getContentText: () => (typeof body === "string" ? body : JSON.stringify(body)) });

  const env = {
    Date: class extends Date { constructor(...a) { a.length ? super(...a) : super(clock); } static now() { return clock; } },
    console: { error: () => {}, log: () => {} },
    LockService: { getScriptLock: () => ({
      tryLock: () => { if (!lockFree) return false; lockFree = false; return true; },
      waitLock: () => { if (!lockFree) throw new Error("Lock timeout"); lockFree = false; },
      releaseLock: () => { lockFree = true; },
    }) },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: (k) => (k in P ? P[k] : null), setProperty: (k, v) => { P[k] = String(v); log.events.push(`prop:${k}`); },
      deleteProperty: (k) => { delete P[k]; }, getKeys: () => Object.keys(P),
    }) },
    SpreadsheetApp: { getActive: () => ({ getSheetByName: (n) => (n === "Lead" ? sheet : null) }), flush: () => { log.flushes++; log.events.push("flush"); } },
    Utilities: { formatDate: fmt },
    Session: { getEffectiveUser: () => ({ getEmail: () => "installer@example.com" }) },
    MailApp: { sendEmail: (to, subject, body) => { if (mailBroken) throw new Error("Service invoked too many times: email"); log.mails.push({ to, subject, body }); } },
    UrlFetchApp: { fetch: (url, o = {}) => {
      if (url.includes("hc-ping")) { log.pings.push(url); return res(200, "OK"); }
      if (o.headers?.["X-CRM-Secret"] !== P.CRM_SECRET || P.SERVER_SECRET === "wrong") return res(401, { error: "Unauthorized" });
      if (server.down > 0) { server.down--; return res(504, "<html>Gateway Time-out</html>"); }
      const body = JSON.parse(o.payload);
      if (url.endsWith("/leads/ingest")) { assert.ok(body.length <= 500); log.posts.push(body.length); return res(200, { results: ingest(body) }); }
      if (url.endsWith("/leads/reconcile")) return res(200, { checked: body.external_ids.length, missing: body.external_ids.filter((id) => !server.byId.has(id) || server.missing.has(id)) });
      return res(404, "not found");
    } },
    ScriptApp: {
      getProjectTriggers: () => triggers.filter((t) => t.owner === "me").map((t) => ({ getHandlerFunction: () => t.fn, t })),
      deleteTrigger: (x) => { triggers = triggers.filter((t) => t !== x.t); },
      newTrigger: (fn) => { const t = { fn, owner: "me" }; const b = { timeBased: () => b, everyMinutes: (n) => ((t.every = `${n}m`), b), everyHours: (n) => ((t.every = `${n}h`), b),
        atHour: () => b, nearMinute: () => b, everyDays: (n) => ((t.every = `${n}d`), b), inTimezone: (z) => ((t.tz = z), b), create: () => { triggers.push(t); } }; return b; },
    },
  };
  const ctx = vm.createContext({ ...env, JSON, Math, Number, String, Object, Array, Error, RegExp });
  vm.runInContext(SRC, ctx);
  return {
    run: (fn) => vm.runInContext(`${fn}()`, ctx), call: (code) => vm.runInContext(code, ctx),
    grid, P, log, server, sheet, sync: (r) => (grid[r - 1] || [])[HEADER.length], // CRM Sync lands in column J
    tick: (ms) => { clock += ms; }, setClock: (ms) => { clock = ms; },
    triggers: () => triggers, holdLock: () => { lockFree = false; }, breakMail: () => { mailBroken = true; },
    retry: () => JSON.parse(P.RETRY || "[]"),
  };
}

test("A1/A3: setup() creates exactly the three triggers, never touches other triggers, re-running adds no duplicates", () => {
  const w = world();
  w.run("setup"); w.run("setup");
  const mine = w.triggers().filter((t) => t.owner === "me").map((t) => `${t.fn}:${t.every}`).sort();
  assert.deepEqual(mine, ["reconcileYesterday:1d", "sweepUnsynced:1h", "syncLeads:1m"]);
  assert.ok(w.triggers().some((t) => t.fn === "onFormSubmit" && t.owner === "other"));
  assert.equal(w.triggers().find((t) => t.fn === "reconcileYesterday").tz, "Asia/Kolkata");
  assert.ok(!/newTrigger|deleteTrigger/.test(SRC.slice(SRC.indexOf("function syncLeads"))), "no trigger changes outside setup()");
});

test("B5/B8/D11/D12/F17: batches of 50, labels written and flushed before the pointer moves; idle run pings without a POST", () => {
  const w = world(Array.from({ length: 120 }, (_, i) => lead(i)), { HC_SYNC_URL: "https://hc-ping.com/sync" });
  w.run("syncLeads");
  assert.deepEqual(w.log.posts, [50, 50, 20]);
  assert.equal(w.P.LAST_SYNCED_ROW, "121");
  assert.match(w.sync(2), /^synced \d\d \w{3} \d\d:\d\d \(LMS-101\)$/);
  const ev = w.log.events, firstPtr = ev.indexOf("prop:LAST_SYNCED_ROW");
  assert.ok(ev.lastIndexOf("flush", firstPtr) > ev.lastIndexOf("write:2", firstPtr), "flush comes after the write and before the pointer");
  w.run("syncLeads");
  assert.deepEqual(w.log.posts, [50, 50, 20], "nothing new: no POST");
  assert.deepEqual(w.log.pings, ["https://hc-ping.com/sync", "https://hc-ping.com/sync"]);
});

test("D12/B7: duplicate, re-enquiry and invalid labels; invalid rows are marked once and not retried", () => {
  const rows = [lead(1), lead(1), lead(2, T0 - 7200e3, String(9100000001)), lead(3, T0, "91000")];
  const w = world(rows);
  w.run("syncLeads");
  assert.match(w.sync(2), /\(LMS-101\)$/);
  assert.equal(w.sync(3), "duplicate");
  assert.equal(w.sync(4), "re-enquiry (LMS-101)");
  assert.equal(w.sync(5), "invalid: Phone needs 10 digits");
  assert.deepEqual(w.retry(), []);
});

test("B6: a row error goes to the retry list by ID; retried next run; found again after the row moves", () => {
  const w = world([lead(1), lead(2), lead(3)]);
  w.server.errorPhones.set("9100000002", 1);
  w.run("syncLeads");
  assert.equal(w.sync(3), "error: db hiccup");
  assert.equal(w.P.LAST_SYNCED_ROW, "4", "pointer moves on: one bad row never blocks the rest");
  assert.deepEqual(w.retry().map((e) => [e.row_hint, e.attempts]), [[3, 1]]);
  w.grid.splice(1, 0, lead(9, T0 - 9e6, "9100000099"));   // someone inserts a row above: the lead is now row 4
  w.tick(60e3); w.run("syncLeads");
  assert.match(w.sync(4), /^synced .*\(LMS-\d+\)$/, "the moved row got its result");
  assert.deepEqual(w.retry(), []);
});

test("B6: gives up after 5 tries with one email; the label says so", () => {
  const w = world([lead(1)]);
  w.server.errorPhones.set("9100000001", 99);
  for (let i = 0; i < 6; i++) { w.run("syncLeads"); w.tick(60e3); }
  assert.match(w.sync(2), /^error \(gave up after 5 tries\): db hiccup$/);
  assert.deepEqual(w.retry(), []);
  assert.equal(w.log.mails.filter((m) => /given up/.test(m.subject)).length, 1);
});

test("Retry cap: the oldest entries stay, the rest are labelled and one email is sent", () => {
  const w = world(Array.from({ length: 60 }, (_, i) => lead(i)));
  w.call("CONFIG.RETRY_MAX_CHARS = 300;");
  for (let i = 0; i < 60; i++) w.server.errorPhones.set(String(9100000000 + i), 99);
  w.run("syncLeads");
  const kept = w.retry();
  assert.ok(kept.length > 0 && JSON.stringify(kept).length <= 300);
  assert.equal(kept[0].row_hint, 2, "oldest first");
  assert.match(w.sync(61), /\(retry list full\)$/);
  assert.equal(w.log.mails.filter((m) => /retry list full/.test(m.subject)).length, 1);
});

test("D13/E15/F18: a 401 leaves rows unsynced; one email an hour with the suppressed count; /fail ping each time", () => {
  const w = world([lead(1)], { HC_SYNC_URL: "https://hc-ping.com/sync", SERVER_SECRET: "wrong" });
  for (let i = 0; i < 3; i++) { w.run("syncLeads"); w.tick(60e3); }
  assert.equal(w.P.LAST_SYNCED_ROW, undefined, "pointer never moved");
  assert.equal(w.sync(2), undefined, "row still unsynced");
  assert.equal(w.log.mails.length, 1);
  assert.deepEqual(w.log.pings, Array(3).fill("https://hc-ping.com/sync/fail"));
  w.tick(3600e3); w.run("syncLeads");
  assert.equal(w.log.mails.length, 2);
  assert.match(w.log.mails[1].body, /2 repeat\(s\) of this alert were suppressed/);
  delete w.P.SERVER_SECRET; w.tick(60e3); w.run("syncLeads");
  assert.match(w.sync(2), /^synced /, "fixed secret: synced on the next run");
});

test("E15: recipients come from ALERT_EMAILS, else the installer; E16: a mail failure cannot crash a run", () => {
  const w = world([lead(1)], { SERVER_SECRET: "wrong", ALERT_EMAILS: "a@x.com,b@y.com" });
  w.run("syncLeads");
  assert.equal(w.log.mails[0].to, "a@x.com,b@y.com");
  const w2 = world([lead(1)], { SERVER_SECRET: "wrong" });
  w2.breakMail();
  assert.doesNotThrow(() => w2.run("syncLeads"));
  const w3 = world([lead(1)], { SERVER_SECRET: "wrong" }); w3.run("syncLeads");
  assert.equal(w3.log.mails[0].to, "installer@example.com");
});

test("C10/H25: lock busy → quiet exit (no POST, no ping, no mail), but the run is still counted", () => {
  const w = world([lead(1)], { HC_SYNC_URL: "https://hc-ping.com/sync" });
  w.holdLock(); w.run("syncLeads");
  assert.deepEqual([w.log.posts, w.log.pings, w.log.mails], [[], [], []]);
  assert.equal(w.P["RUNS_2026-11-08"], "1");
});

test("Sweep: blank CRM Sync rows above the pointer are sent; rows past the pointer are left to syncLeads", () => {
  const w = world([lead(1), lead(2), lead(3), lead(4)]);
  w.run("syncLeads");
  w.grid[2][HEADER.length] = "";          // row 3 lost its result (e.g. sorted in from elsewhere)
  w.grid.push(lead(5));                    // a new row past the pointer
  w.run("sweepUnsynced");
  assert.equal(w.sync(3), "duplicate", "re-sent; the server already had it");
  assert.equal(w.sync(6), undefined, "new row untouched by the sweep");
  assert.equal(w.P["SWEPT_2026-11-08"], "1");
});

test("Nightly: MISMATCH then OK, re-send, sweep count, run time with the 45-min warning, counters reset, own heartbeat", () => {
  const y = T0 - 864e5;                  // a time on yesterday (IST)
  const w = world([lead(1, y), lead(2, y), lead(3, T0)], { HC_NIGHTLY_URL: "https://hc-ping.com/nightly" });
  w.run("syncLeads");
  w.server.missing.add(w.call("rowId_(sheet_().getRange(3,1,1,10).getValues()[0], headers_(sheet_()))"));
  Object.assign(w.P, { "RUN_MS_2026-11-07": String(50 * 60e3), "RUNS_2026-11-07": "1440", "SWEPT_2026-11-07": "3" });
  w.run("reconcileYesterday");
  const m = w.log.mails.at(-1);
  assert.match(m.subject, /^MISMATCH 1 \/ 2 · CallFlow leads 2026-11-07$/);
  assert.match(m.body, /Rows in the sheet: 2\nLeads in the CRM:  1\nMissing:           1/);
  assert.match(m.body, /Hourly sweep:      3 row/);
  assert.match(m.body, /50\.0 min over 1440 runs/);
  assert.match(m.body, /WARNING: over 45 min.*every 2 minutes/);
  assert.equal(w.P["RUN_MS_2026-11-07"], undefined, "counters reset after the report");
  assert.deepEqual(w.log.pings, ["https://hc-ping.com/nightly"]);
  w.server.missing.clear(); w.run("reconcileYesterday");
  assert.match(w.log.mails.at(-1).subject, /^OK 2 \/ 2 /);
  assert.doesNotMatch(w.log.mails.at(-1).body, /WARNING/);
});

test("Nightly: lock busy → /fail ping + alert (never silently skipped)", () => {
  const w = world([], { HC_NIGHTLY_URL: "https://hc-ping.com/nightly" });
  w.holdLock(); w.run("reconcileYesterday");
  assert.deepEqual(w.log.pings, ["https://hc-ping.com/nightly/fail"]);
  assert.match(w.log.mails[0].subject, /Nightly check skipped/);
});

test("TEST_MODE guard: refuses production; test helpers only work in TEST_MODE and insert rows that then sync", () => {
  const w = world([lead(1)], { TEST_MODE: "true", HC_SYNC_URL: "https://hc-ping.com/sync" });
  w.run("syncLeads");
  assert.deepEqual(w.log.posts, []);
  assert.match(w.log.mails[0].body, /refusing to run/);
  assert.deepEqual(w.log.pings, ["https://hc-ping.com/sync/fail"]);
  assert.throws(() => world([lead(1)]).run("testInsertRows"), /TEST_MODE=true/);
  const t = world([], { TEST_MODE: "true", API_BASE: "https://abc.trycloudflare.com/api/v1/crm" });
  t.call("testInsertRows(2)"); t.run("testInsertDuplicate");
  t.run("syncLeads");
  assert.match(t.sync(2), /^synced /); assert.match(t.sync(3), /^synced /);
  assert.equal(t.sync(4), "duplicate");
});
