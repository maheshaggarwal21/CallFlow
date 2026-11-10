/**
 * CRM behaviour against a real Postgres. LOCAL ONLY: refuses any non-local host.
 * Uses its own markers (staff @crm-test.local, leads source 'test', calls
 * crmtest/) and removes them before and after, so it never touches demo data.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import pool from "../../db/pool";
import { assertLocalDb } from "./localDb";
import { claimLock, CrmError, getCodes, ingestRows, queue, updateLeadFields, reapplyCodeRoles, reconcile, saveOutcome } from "../../services/crm.service";
import { DEFAULT_CODES, outcomeSchema } from "./rules";

assertLocalDb(process.env.DATABASE_URL, "crm db.test");

type U = { sub: string; role: "employee"; name: string };
let neha: U, priya: U, raman: U;

async function cleanup() {
  await pool.query("DELETE FROM calls WHERE source_file_key LIKE 'crmtest/%'");
  await pool.query("DELETE FROM leads WHERE source = 'test'");
  await pool.query("DELETE FROM employees WHERE email LIKE '%@crm-test.local'");
}

async function rep(name: string): Promise<U> {
  const { rows: [e] } = await pool.query(
    `INSERT INTO employees (name, email, role, password_hash) VALUES ($1, $2, 'employee', 'x') RETURNING id`,
    [name, `${name.toLowerCase()}@crm-test.local`]
  );
  return { sub: e.id, role: "employee", name };
}

let n = 0;
async function lead(p10: string) {
  const { rows: [l] } = await pool.query(
    `INSERT INTO leads (name, phone_raw, phone10, source) VALUES ('Test Lead', $1, $1, 'test') RETURNING id, version`, [p10]
  );
  return l as { id: string; version: number };
}
async function call(p10: string, emp: string, calledAt: Date, dur = 120) {
  const { rows: [c] } = await pool.query(
    `INSERT INTO calls (source_file_key, call_direction, caller_phone, called_at, duration_secs, employee_id)
     VALUES ($1, 'outbound', $2, $3, $4, $5) RETURNING id`,
    [`crmtest/${++n}.wav`, `0${p10}`, calledAt, dur, emp]
  );
  return c.id as string;
}
const linkedCall = async (interactionId: string) =>
  (await pool.query("SELECT call_id FROM lead_interactions WHERE id = $1", [interactionId])).rows[0].call_id;
const out = (o: object) => outcomeSchema.parse(o);
const min = (m: number) => new Date(Date.now() + m * 60_000);

let storedCodes: unknown;
before(async () => {
  storedCodes = (await pool.query("SELECT value FROM crm_settings WHERE key = 'codes'")).rows[0]?.value;
  await pool.query("UPDATE crm_settings SET value = $1 WHERE key = 'codes'", [JSON.stringify(DEFAULT_CODES)]);
  await cleanup();
  neha = await rep("Neha");
  priya = await rep("Priya");
  raman = await rep("Ramandeep");
});
after(async () => {
  await cleanup();
  if (storedCodes) await pool.query("UPDATE crm_settings SET value = $1 WHERE key = 'codes'", [JSON.stringify(storedCodes)]);
  await pool.end();
});

test("lock: second rep is told who holds it; stale version is a 409 naming the editor", async () => {
  const l = await lead("9000020001");
  assert.equal((await claimLock(l.id, neha.sub)).mine, true);
  const other = await claimLock(l.id, priya.sub);
  assert.equal(other.mine, false);
  assert.equal(other.locked_by_name, "Neha");
  await assert.rejects(saveOutcome(l.id, priya, out({ version: 1, code: "B" })), (e: CrmError) => e.status === 423);

  const saved = await saveOutcome(l.id, neha, out({ version: 1, code: "B" }));
  assert.equal(saved.version, 2);
  // Lock released on save; Priya's form still carries version 1
  await assert.rejects(saveOutcome(l.id, priya, out({ version: 1, code: "B" })),
    (e: CrmError) => e.status === 409 && /updated by Neha/.test(e.message));
  assert.equal((await saveOutcome(l.id, priya, out({ version: 2, code: "B" }))).version, 3);
});

test("matching: form saved after the recording links to it (same rep, ±30 min only)", async () => {
  const l = await lead("9000020002");
  await call("9000020002", priya.sub, min(-3));          // other rep: never linked
  await call("9000020002", neha.sub, min(-45));          // outside the window
  const near = await call("9000020002", neha.sub, min(-4));
  const r = await saveOutcome(l.id, neha, out({ version: 1, code: "F", reason: "UPI", note: "Paid 299 on UPI on this call" }));
  assert.equal(r.call_id, near);
  const { rows: [c] } = await pool.query("SELECT keep_audio, lead_id FROM calls WHERE id = $1", [near]);
  assert.deepEqual(c, { keep_audio: true, lead_id: l.id });  // F keeps its recording
});

test("matching: a recording arriving 2 h late still links (window is on called_at)", async () => {
  const l = await lead("9000020003");
  const r = await saveOutcome(l.id, neha, out({ version: 1, code: "B" }));
  assert.equal(r.call_id, null);                          // nothing yet; the save is not blocked
  // FTP upload lands two hours later, but the call itself started 3 min before the save
  const late = await call("9000020003", neha.sub, min(-3));
  assert.equal(await linkedCall(r.interaction_id), late);
});

test("matching: a call whose called_at is corrected by 2 h then matches", async () => {
  const l = await lead("9000020004");
  const r = await saveOutcome(l.id, neha, out({ version: 1, code: "C" }));
  const c = await call("9000020004", neha.sub, min(-122)); // PBX clock 2 h behind
  assert.equal(await linkedCall(r.interaction_id), null);
  await pool.query("UPDATE calls SET called_at = called_at + interval '2 hours' WHERE id = $1", [c]); // fixClockDrift
  assert.equal(await linkedCall(r.interaction_id), c);
});

test("matching never blocks a recording: trigger errors are logged instead", async () => {
  const before = (await pool.query("SELECT count(*)::int AS n FROM crm_match_errors")).rows[0].n;
  await pool.query("ALTER TABLE lead_interactions RENAME COLUMN call_id TO call_id_broken");
  try {
    await lead("9000020005");
    const id = await call("9000020005", neha.sub, min(-1));  // insert must still succeed
    assert.ok(id);
  } finally {
    await pool.query("ALTER TABLE lead_interactions RENAME COLUMN call_id_broken TO call_id");
  }
  const errs = await pool.query("SELECT error FROM crm_match_errors ORDER BY id DESC LIMIT 1");
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM crm_match_errors")).rows[0].n, before + 1);
  assert.match(errs.rows[0].error, /call_id/);
  await pool.query("DELETE FROM crm_match_errors WHERE error LIKE '%call_id%' AND created_at > NOW() - interval '1 minute'");
});

test("ingest is idempotent; the same number re-enquires instead of duplicating", async () => {
  const rows = [
    { external_id: "t-1", name: "Asha", phone: "+91 90000 20010", source: "test" },
    { external_id: "t-2", name: "Bad", phone: "12345", source: "test" },
  ];
  const first = await ingestRows(rows);
  assert.deepEqual(first.map((r) => r.result), ["created", "invalid"]);
  const again = await ingestRows(rows);
  assert.deepEqual(again.map((r) => r.result), ["duplicate", "invalid"]);

  await pool.query("UPDATE leads SET status = 'dnc', current_code = 'G' WHERE phone10 = '9000020010'");
  const re = await ingestRows([{ external_id: "t-3", name: "Asha", phone: "09000020010", source: "test" }]);
  assert.equal(re[0].result, "reenquired");
  assert.equal((await ingestRows([{ external_id: "t-3", phone: "09000020010", source: "test" }]))[0].result, "duplicate");
  const { rows: leads } = await pool.query("SELECT status, tags FROM leads WHERE phone10 = '9000020010'");
  assert.equal(leads.length, 1);
  assert.equal(leads[0].status, "new");
  assert.deepEqual(leads[0].tags, ["re-enquired"]);
  assert.deepEqual(await reconcile(["t-1", "t-3", "t-404"]), ["t-404"]);
});

test("form save: representative and guitar are kept; a later save without them keeps both", async () => {
  const l = await lead("9000020020");
  await saveOutcome(l.id, neha, out({ version: 1, code: "B", assigned_to: priya.sub, has_guitar: true }));
  const row = async () => (await pool.query("SELECT assigned_to, has_guitar, version FROM leads WHERE id = $1", [l.id])).rows[0];
  assert.deepEqual(await row(), { assigned_to: priya.sub, has_guitar: true, version: 2 });
  await saveOutcome(l.id, neha, out({ version: 2, code: "B" }));
  assert.deepEqual(await row(), { assigned_to: priya.sub, has_guitar: true, version: 3 });
});

test("sheet import: status, rep, guitar and amount come across; no follow-up time, so not in the due lists", async () => {
  const res = await ingestRows([
    { external_id: "t-s1", name: "Old D", phone: "9000020030", source: "test", status: "d", rep: "NEHA", guitar: "Yes", amount: "299" },
    { external_id: "t-s2", name: "Old F", phone: "9000020031", source: "test", status: "F", rep: "nobody", guitar: "No", amount: "299" },
    { external_id: "t-s3", name: "Blank", phone: "9000020032", source: "test", status: "", rep: "", amount: "299" },
    { external_id: "t-s4", name: "Short", phone: "9000020033", source: "test", status: "A", rep: "Raman" },
  ]);
  assert.deepEqual(res.map((r) => r.result), ["created", "created", "created", "created"]);
  const { rows } = await pool.query(
    "SELECT phone10, status, current_code, assigned_to, has_guitar, amount::float AS amount, next_followup_at FROM leads WHERE phone10 LIKE '900002003%' ORDER BY phone10");
  assert.deepEqual(rows.map((r) => [r.status, r.current_code, r.assigned_to, r.has_guitar, r.amount]), [
    ["callback", "D", neha.sub, true, null],   // 299 on the sheet is the price, not a payment
    ["converted", "F", null, false, 299],
    ["new", null, null, null, null],
    ["retry", "A", raman.sub, null, null],     // "Raman" on the sheet = the only first name starting with it
  ]);
  assert.equal(rows[0].next_followup_at, null);
  const history = await pool.query("SELECT kind, code FROM lead_interactions i JOIN leads l ON l.id = i.lead_id WHERE l.phone10 = '9000020030'");
  assert.deepEqual(history.rows, [{ kind: "system", code: "D" }]);
  const q = await queue(neha, { q: "Old D" });
  assert.equal(Object.values(q.sections).flat().length, 0);
});

test("a letter the sheet uses but Settings doesn't know is added as Not used; other junk is ignored", async () => {
  await pool.query("UPDATE crm_settings SET value = value - 'X' WHERE key = 'codes'");
  const res = await ingestRows([
    { external_id: "t-u1", name: "Typo", phone: "9000020050", source: "test", status: "x" },
    { external_id: "t-u2", name: "Junk", phone: "9000020051", source: "test", status: "NA" },
  ]);
  assert.deepEqual(res.map((r) => r.result), ["created", "created"]);
  const codes = await getCodes();
  assert.deepEqual(codes.X, { label: "Code X", role: "unused" });
  const { rows } = await pool.query("SELECT current_code, status FROM leads WHERE phone10 IN ('9000020050','9000020051') ORDER BY phone10");
  assert.deepEqual(rows, [{ current_code: "X", status: "dnc" }, { current_code: null, status: "new" }]);
  await pool.query("UPDATE crm_settings SET value = value - 'X' WHERE key = 'codes'");
});

test("changing a code's role in settings moves its leads to the new status", async () => {
  const l = await lead("9000020040");
  await saveOutcome(l.id, neha, out({ version: 1, code: "B" }));
  const codes = { ...DEFAULT_CODES, B: { label: "No response", role: "closed" as const } };
  const client = await pool.connect();
  try { await reapplyCodeRoles(client, codes); } finally { client.release(); }
  const { rows: [r] } = await pool.query("SELECT status, next_followup_at, version FROM leads WHERE id = $1", [l.id]);
  assert.deepEqual(r, { status: "dnc", next_followup_at: null, version: 3 });
});

test("queue loads only what the page shows: due, overdue, retry due and later today; no New leads, nothing from tomorrow", async () => {
  const now = new Date("2026-11-08T06:30:00Z"); // 12:00 IST
  const at = (h: number) => new Date(now.getTime() + h * 3_600_000);
  const add = (name: string, p10: string, status: string, next: Date | null) => pool.query(
    "INSERT INTO leads (name, phone_raw, phone10, source, status, next_followup_at) VALUES ($1, $2, $2, 'test', $3, $4)", [name, p10, status, next]);
  await add("QTest due", "9000020060", "callback", at(5 / 60));
  await add("QTest overdue", "9000020061", "callback", at(-2));
  await add("QTest retry", "9000020062", "retry", at(-1));
  await add("QTest tonight", "9000020063", "callback", at(6));        // 18:00 IST today
  await add("QTest tomorrow", "9000020064", "callback", at(22));      // 10:00 IST tomorrow
  await add("QTest new", "9000020065", "new", null);
  const q = await queue(neha, { q: "QTest" }, now);
  const names = (b: keyof typeof q.sections) => (q.sections[b] as { name: string }[]).map((l) => l.name);
  assert.deepEqual([names("due_now"), names("overdue"), names("retry"), names("later"), names("new")],
    [["QTest due"], ["QTest overdue"], ["QTest retry"], ["QTest tonight"], []]);
  assert.equal(typeof q.kpis.new_leads, "number");
  assert.equal(q.counts.new, q.kpis.new_leads, "New is a count only");
});

test("edit in the table: rep, guitar and follow-up change with a history line; version, lock and status rules hold", async () => {
  const l = await lead("9000020070");
  const row = async () => (await pool.query("SELECT assigned_to, has_guitar, next_followup_at, version FROM leads WHERE id = $1", [l.id])).rows[0];
  assert.deepEqual(await updateLeadFields(l.id, neha, { version: 1, assigned_to: priya.sub, has_guitar: true }), { version: 2 });
  assert.deepEqual(await row(), { assigned_to: priya.sub, has_guitar: true, next_followup_at: null, version: 2 });
  // A New lead has no follow-up to move
  await assert.rejects(updateLeadFields(l.id, neha, { version: 2, next_followup_at: min(60).toISOString() }), /status with a follow-up/);
  await saveOutcome(l.id, neha, out({ version: 2, code: "B" }));   // retry → it now has one
  const at = min(120);
  assert.deepEqual(await updateLeadFields(l.id, neha, { version: 3, next_followup_at: at.toISOString() }), { version: 4 });
  assert.equal((await row()).next_followup_at.getTime(), at.getTime());
  // Stale copy → 409 naming who changed it; someone else's lock → 423
  await assert.rejects(updateLeadFields(l.id, priya, { version: 3, has_guitar: false }), (e: unknown) => e instanceof CrmError && e.status === 409);
  await claimLock(l.id, priya.sub);
  await assert.rejects(updateLeadFields(l.id, neha, { version: 4, has_guitar: false }), (e: unknown) => e instanceof CrmError && e.status === 423);
  const { rows } = await pool.query("SELECT note FROM lead_interactions WHERE lead_id = $1 AND kind = 'system' ORDER BY created_at", [l.id]);
  assert.match(rows[0].note, /Changed in the table: Assigned to Priya · Guitar: Yes/);
  assert.match(rows[1].note, /Next follow-up/);
});

test("edit in the table: amount and last contacted change (and clear); a future last contacted is refused", async () => {
  const l = await lead("9000020071");
  const row = async () => (await pool.query("SELECT amount, last_contacted_at, version FROM leads WHERE id = $1", [l.id])).rows[0];
  const at = min(-90);
  assert.deepEqual(await updateLeadFields(l.id, neha, { version: 1, amount: 499, last_contacted_at: at.toISOString() }), { version: 2 });
  const r = await row();
  assert.equal(Number(r.amount), 499);
  assert.equal(r.last_contacted_at.getTime(), at.getTime());
  assert.deepEqual(await updateLeadFields(l.id, neha, { version: 2, amount: null }), { version: 3 });
  assert.equal((await row()).amount, null);
  await assert.rejects(updateLeadFields(l.id, neha, { version: 3, last_contacted_at: min(30).toISOString() }), /future/);
  const { rows } = await pool.query("SELECT note FROM lead_interactions WHERE lead_id = $1 AND kind = 'system' ORDER BY created_at", [l.id]);
  assert.match(rows[0].note, /Amount: ₹499 · Last contacted/);
});
