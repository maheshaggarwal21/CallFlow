/**
 * CRM behaviour against a real Postgres. LOCAL ONLY: refuses any non-local host.
 * Uses its own markers (staff @crm-test.local, leads source 'test', calls
 * crmtest/) and removes them before and after, so it never touches demo data.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import pool from "../../db/pool";
import { assertLocalDb } from "./localDb";
import { assignLeads, claimLock, CrmError, ingestRows, reconcile, saveOutcome } from "../../services/crm.service";
import { outcomeSchema } from "./rules";

assertLocalDb(process.env.DATABASE_URL, "crm db.test");

type U = { sub: string; role: "employee"; name: string };
let neha: U, priya: U;

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

before(async () => {
  await cleanup();
  neha = await rep("Neha");
  priya = await rep("Priya");
});
after(async () => {
  await cleanup();
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

  await pool.query("UPDATE leads SET status = 'dnc', current_code = 'Z' WHERE phone10 = '9000020010'");
  const re = await ingestRows([{ external_id: "t-3", name: "Asha", phone: "09000020010", source: "test" }]);
  assert.equal(re[0].result, "reenquired");
  assert.equal((await ingestRows([{ external_id: "t-3", phone: "09000020010", source: "test" }]))[0].result, "duplicate");
  const { rows: leads } = await pool.query("SELECT status, tags FROM leads WHERE phone10 = '9000020010'");
  assert.equal(leads.length, 1);
  assert.equal(leads[0].status, "new");
  assert.deepEqual(leads[0].tags, ["re-enquired"]);
  assert.deepEqual(await reconcile(["t-1", "t-3", "t-404"]), ["t-404"]);
});

test("assign: leads go to a rep and back to the pool, bumping version and logging it", async () => {
  const a = await lead("9000020020"), b = await lead("9000020021");
  const owner = { sub: priya.sub, role: "owner" as const, name: "Owner" } as unknown as U;
  const r = await assignLeads([a.id, b.id], neha.sub, owner);
  assert.deepEqual(r, { updated: 2, assigned_to_name: "Neha" });
  assert.equal((await assignLeads([a.id], neha.sub, owner)).updated, 0);  // already Neha's: no-op
  const { rows } = await pool.query("SELECT assigned_to, version FROM leads WHERE id = $1", [a.id]);
  assert.deepEqual(rows[0], { assigned_to: neha.sub, version: 2 });
  // A form opened before the assignment now gets the 409 reload
  await assert.rejects(saveOutcome(a.id, neha, out({ version: 1, code: "B" })), (e: CrmError) => e.status === 409);
  await assignLeads([a.id], null, owner);
  assert.equal((await pool.query("SELECT assigned_to FROM leads WHERE id = $1", [a.id])).rows[0].assigned_to, null);
  const notes = (await pool.query("SELECT note FROM lead_interactions WHERE lead_id = $1 AND kind = 'system' ORDER BY created_at", [a.id])).rows.map((x) => x.note);
  assert.deepEqual(notes, ["Assigned to Neha by Owner", "Moved back to the shared pool by Owner"]);
  const prev = (await pool.query("SELECT meta->>'previous' AS p FROM lead_interactions WHERE lead_id = $1 AND kind = 'system' ORDER BY created_at DESC LIMIT 1", [a.id])).rows[0].p;
  assert.equal(prev, neha.sub);  // the unassign remembers Neha had it
  await assert.rejects(assignLeads([b.id], "00000000-0000-0000-0000-000000000000", owner), (e: CrmError) => e.status === 400);
});
