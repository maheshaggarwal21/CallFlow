import type { PoolClient } from "pg";
import { z } from "zod";
import pool from "../db/pool";
import { IST_TODAY_START } from "../lib/dateRange";
import { isFullPhone10, phone10 } from "../lib/crm/phone";
import { DUE_WINDOW_MS, bucketOf, compareQueue, type QueueBucket } from "../lib/crm/queue";
import {
  CODE_RE, DEFAULT_CODES, DEFAULT_RETRY, codeLetters, PERMISSIONS, STATUS_OF_ROLE, keepsAudio, nextState, validateOutcome,
  type CodeSettings, type OutcomeInput, type Permission, type RetryRules,
} from "../lib/crm/rules";
import { audioUrlsFor } from "./audioUrls";

export const LOCK_MINUTES = 5;
export const MATCH_WINDOW = "30 minutes";
const RETENTION_DAYS = Number(process.env.RETENTION_DAYS ?? 90);

/** An error with an HTTP status, turned into a JSON response by the CRM router. */
export class CrmError extends Error {
  constructor(public status: number, message: string, public extra: Record<string, unknown> = {}) {
    super(message);
  }
}

type User = { sub: string; role: "owner" | "employee"; name: string };

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const { rows } = await pool.query("SELECT value FROM crm_settings WHERE key = $1", [key]);
  return rows[0] ? { ...fallback, ...rows[0].value } : fallback;
}

/** The owner's codes as stored (not merged with the defaults: a removed default must stay gone). */
export async function getCodes(): Promise<CodeSettings> {
  const { rows } = await pool.query("SELECT value FROM crm_settings WHERE key = 'codes'");
  return rows[0]?.value ?? DEFAULT_CODES;
}

/** A letter the sheet uses but Settings doesn't know: add it as "Not used" for the owner to name. */
async function addUnknownCode(codes: CodeSettings, letter: string) {
  codes[letter] = { label: `Code ${letter}`, role: "unused" };
  await pool.query(
    `UPDATE crm_settings SET value = value || jsonb_build_object($1::text, $2::jsonb), updated_at = NOW()
     WHERE key = 'codes' AND NOT value ? $1`,
    [letter, JSON.stringify(codes[letter])]
  );
}

/** After the owner changes what a code means, move leads on that code to the matching status. */
export async function reapplyCodeRoles(client: PoolClient, codes: CodeSettings) {
  const pairs = codeLetters(codes).map((c) => [c, STATUS_OF_ROLE[codes[c].role]]);
  await client.query(
    `UPDATE leads l SET status = v.status,
       next_followup_at = CASE WHEN v.status IN ('retry','callback') THEN l.next_followup_at END,
       version = l.version + 1, updated_at = NOW()
     FROM unnest($1::text[], $2::text[]) AS v(code, status)
     WHERE l.current_code = v.code AND l.status NOT IN ('new','dropped') AND l.status <> v.status`,
    [pairs.map((p) => p[0]), pairs.map((p) => p[1])]
  );
}

export async function permissionsOf(user: User): Promise<Permission[]> {
  if (user.role === "owner") return [...PERMISSIONS];
  const { rows } = await pool.query("SELECT permission FROM employee_permissions WHERE employee_id = $1", [user.sub]);
  return rows.map((r) => r.permission);
}

// ── Soft lock ──────────────────────────────────────────────────────────────

/** Claim or extend the 5-minute lock. Returns who holds it when someone else does. */
export async function claimLock(leadId: string, userId: string) {
  const { rows } = await pool.query(
    `UPDATE leads SET locked_by = $2, locked_until = NOW() + make_interval(mins => $3)
     WHERE id = $1 AND (locked_by IS NULL OR locked_by = $2 OR locked_until < NOW())
     RETURNING locked_until`,
    [leadId, userId, LOCK_MINUTES]
  );
  if (rows[0]) return { mine: true, locked_by_name: null, locked_until: rows[0].locked_until };
  const held = await pool.query(
    "SELECT l.locked_until, e.name FROM leads l LEFT JOIN employees e ON e.id = l.locked_by WHERE l.id = $1",
    [leadId]
  );
  if (!held.rows[0]) throw new CrmError(404, "Lead not found");
  return { mine: false, locked_by_name: held.rows[0].name as string, locked_until: held.rows[0].locked_until };
}

export async function releaseLock(leadId: string, userId: string) {
  await pool.query("UPDATE leads SET locked_by = NULL, locked_until = NULL WHERE id = $1 AND locked_by = $2", [leadId, userId]);
}

// ── Save an outcome ────────────────────────────────────────────────────────

/**
 * Link the nearest unlinked recording of this number by this rep within ±30 min
 * of `at`. Recordings usually arrive minutes after the save; then the calls
 * trigger (011_crm_2_calls.sql) does the reverse link. Never throws: a failed
 * link must not fail the save.
 */
export async function linkNearestCall(client: PoolClient, interactionId: string, p10: string, employeeId: string, at: Date, keepAudio: boolean) {
  await client.query("SAVEPOINT link_call");
  try {
    const { rows } = await client.query(
      `WITH c AS (
         SELECT c.id FROM calls c
         WHERE c.phone10 = $2 AND c.employee_id = $3
           AND c.called_at BETWEEN $4::timestamptz - interval '${MATCH_WINDOW}' AND $4::timestamptz + interval '${MATCH_WINDOW}'
           AND NOT EXISTS (SELECT 1 FROM lead_interactions i WHERE i.call_id = c.id)
         ORDER BY abs(extract(epoch FROM c.called_at - $4::timestamptz))
         LIMIT 1 FOR UPDATE SKIP LOCKED)
       UPDATE lead_interactions SET call_id = c.id FROM c WHERE lead_interactions.id = $1
       RETURNING c.id`,
      [interactionId, p10, employeeId, at.toISOString()]
    );
    const callId: string | null = rows[0]?.id ?? null;
    if (callId) {
      await client.query(
        `UPDATE calls SET lead_id = (SELECT lead_id FROM lead_interactions WHERE id = $2),
                          keep_audio = keep_audio OR $3 WHERE id = $1`,
        [callId, interactionId, keepAudio]
      );
    }
    await client.query("RELEASE SAVEPOINT link_call");
    return callId;
  } catch (e) {
    await client.query("ROLLBACK TO SAVEPOINT link_call");
    console.error("[crm] linking a call failed (save kept):", e);
    return null;
  }
}

export async function saveOutcome(leadId: string, user: User, input: OutcomeInput, now = new Date()) {
  const [rules, codes] = await Promise.all([getSetting<RetryRules>("retry_rules", DEFAULT_RETRY), getCodes()]);
  const problem = validateOutcome(input, now, codes);
  if (problem) throw new CrmError(400, problem);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: [lead] } = await client.query(
      `SELECT l.*, u.name AS updated_by_name, k.name AS locked_by_name
       FROM leads l LEFT JOIN employees u ON u.id = l.updated_by LEFT JOIN employees k ON k.id = l.locked_by
       WHERE l.id = $1 FOR UPDATE OF l`,
      [leadId]
    );
    if (!lead) throw new CrmError(404, "Lead not found");
    if (lead.version !== input.version) {
      const who = lead.updated_by_name ?? "someone else";
      throw new CrmError(409, `This lead was updated by ${who}, reload`, { updated_by: who, version: lead.version });
    }
    if (lead.locked_by && lead.locked_by !== user.sub && new Date(lead.locked_until) > now) {
      throw new CrmError(423, `${lead.locked_by_name} is on this lead`, { locked_by: lead.locked_by_name });
    }

    const s = nextState(lead.attempts, input, rules, now, codes);
    const { rows: [ix] } = await client.query(
      `INSERT INTO lead_interactions (lead_id, employee_id, kind, code, reason, note, next_followup_at, meta)
       VALUES ($1, $2, 'call_outcome', $3, $4, $5, $6, $7) RETURNING id, created_at`,
      [leadId, user.sub, input.code, input.reason || null, input.note || null,
       s.next_followup_at, JSON.stringify({ status: s.status, attempts: s.attempts, amount: s.amount, assigned_to: input.assigned_to ?? null, previous: lead.assigned_to })]
    );
    const { rows: [saved] } = await client.query(
      `UPDATE leads SET status = $2::text, current_code = $3, next_followup_at = $4, attempts = $5,
         amount = COALESCE($6, amount),
         callback_set_by = CASE WHEN $2::text = 'callback' THEN $7::uuid END,
         last_contacted_at = NOW(), version = version + 1, updated_by = $7, updated_at = NOW(),
         locked_by = NULL, locked_until = NULL,
         assigned_to = COALESCE($8::uuid, CASE WHEN $2::text = 'callback' THEN $7::uuid ELSE assigned_to END),
         has_guitar = COALESCE($9, has_guitar)
       WHERE id = $1 RETURNING version`,
      [leadId, s.status, s.current_code, s.next_followup_at, s.attempts, s.amount, user.sub, input.assigned_to ?? null, input.has_guitar ?? null]
    );
    const callId = await linkNearestCall(client, ix.id, lead.phone10, user.sub, new Date(ix.created_at), keepsAudio(codes[input.code].role));
    await client.query("COMMIT");
    return { version: saved.version as number, interaction_id: ix.id as string, call_id: callId, status: s.status };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

// ── Lead detail + history ──────────────────────────────────────────────────

export async function leadDetail(leadId: string) {
  const { rows: [lead] } = await pool.query(
    `SELECT l.id, l.lead_code, l.name, l.email, l.phone_raw, l.phone10, l.source, l.campaign, l.external_id,
            l.status, l.current_code, l.next_followup_at, l.attempts, l.last_contacted_at,
            l.amount, l.has_guitar, l.tags, l.version, l.created_at, l.updated_at, l.locked_until,
            l.locked_by, k.name AS locked_by_name, cb.name AS callback_set_by_name, u.name AS updated_by_name,
            l.assigned_to, a.name AS assigned_to_name
     FROM leads l
     LEFT JOIN employees k ON k.id = l.locked_by AND l.locked_until > NOW()
     LEFT JOIN employees cb ON cb.id = l.callback_set_by
     LEFT JOIN employees a ON a.id = l.assigned_to
     LEFT JOIN employees u ON u.id = l.updated_by
     WHERE l.id = $1`,
    [leadId]
  );
  if (!lead) throw new CrmError(404, "Lead not found");
  if (!lead.locked_by_name) lead.locked_by = null;

  const [ixRes, callRes] = await Promise.all([
    pool.query(
      `SELECT i.id, i.kind, i.code, i.reason, i.note, i.next_followup_at, i.call_id, i.meta, i.created_at,
              i.employee_id, e.name AS employee_name
       FROM lead_interactions i
       LEFT JOIN employees e ON e.id = i.employee_id
       WHERE i.lead_id = $1 ORDER BY i.created_at DESC`,
      [leadId]
    ),
    // Every recording of this number, by every rep — not scoped like /calls/search
    pool.query(
      `SELECT c.id, c.called_at, c.duration_secs, c.call_direction, c.employee_id, e.name AS employee_name,
              c.audio_storage_key, c.keep_audio
       FROM calls c
       LEFT JOIN employees e ON e.id = c.employee_id
       WHERE c.phone10 = $1 ORDER BY c.called_at DESC LIMIT 200`,
      [lead.phone10]
    ),
  ]);

  const expiredBefore = Date.now() - RETENTION_DAYS * 86_400_000;
  const calls = await Promise.all(callRes.rows.map(async (c) => {
    const audio = c.audio_storage_key ? await audioUrlsFor(c.id, c.audio_storage_key) : null;
    return {
      id: c.id, called_at: c.called_at, duration_secs: c.duration_secs, direction: c.call_direction,
      employee_id: c.employee_id, employee_name: c.employee_name, keep_audio: c.keep_audio,
      audio_urls: audio?.audio_urls ?? null,
      audio_format: audio?.audio_format ?? null,
      audio_state: audio?.audio_urls ? "ok" : !c.audio_storage_key && new Date(c.called_at).getTime() < expiredBefore ? "expired" : "missing",
    };
  }));
  const byId = new Map(calls.map((c) => [c.id, c]));
  const linked = new Set<string>();

  const timeline: Record<string, unknown>[] = ixRes.rows.map((i) => {
    const call = i.call_id ? byId.get(i.call_id) ?? null : null;
    if (call) linked.add(call.id);
    return { type: "interaction", at: i.created_at, ...i, call };
  });
  for (const c of calls) if (!linked.has(c.id)) timeline.push({ type: "call", at: c.called_at, call: c });
  timeline.sort((a, b) => new Date(b.at as string).getTime() - new Date(a.at as string).getTime());

  return { lead, timeline, server_now: new Date() };
}

// ── Queue ──────────────────────────────────────────────────────────────────

export const queueFilterSchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.string().max(20).optional(),
  code: z.string().max(1).optional(),
  campaign: z.string().max(150).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** Next follow-up on this IST day */
  fdate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  // "me", "none" (unassigned) or an employee id
  assigned: z.union([z.enum(["me", "none"]), z.string().uuid()]).optional(),
});
type Filters = z.infer<typeof queueFilterSchema>;

/** WHERE fragments shared by the queue, the All Leads table and the CSV export. */
export function leadFilters(f: Filters, values: unknown[], meId?: string): string[] {
  const where: string[] = [];
  const add = (sql: (n: number) => string, v: unknown) => { values.push(v); where.push(sql(values.length)); };
  if (f.q) {
    const digits = f.q.replace(/\D/g, "");
    values.push(`%${f.q}%`);
    const n = values.length;
    let clause = `(l.name ILIKE $${n} OR l.lead_code ILIKE $${n}`;
    if (digits.length >= 3) { values.push(`%${digits}%`); clause += ` OR l.phone10 LIKE $${values.length}`; }
    where.push(clause + ")");
  }
  if (f.status) add((n) => `l.status = $${n}`, f.status);
  if (f.code) add((n) => `l.current_code = $${n}`, f.code);
  if (f.campaign) add((n) => `l.campaign = $${n}`, f.campaign);
  if (f.date) add((n) => `(l.created_at AT TIME ZONE 'Asia/Kolkata')::date = $${n}::date`, f.date);
  if (f.from) add((n) => `(l.created_at AT TIME ZONE 'Asia/Kolkata')::date >= $${n}::date`, f.from);
  if (f.to) add((n) => `(l.created_at AT TIME ZONE 'Asia/Kolkata')::date <= $${n}::date`, f.to);
  if (f.fdate) add((n) => `(l.next_followup_at AT TIME ZONE 'Asia/Kolkata')::date = $${n}::date`, f.fdate);
  if (f.assigned === "none") where.push("l.assigned_to IS NULL");
  else if (f.assigned) add((n) => `l.assigned_to = $${n}`, f.assigned === "me" ? meId : f.assigned);
  return where;
}

export const LEAD_LIST_COLS = `
  l.id, l.lead_code, l.version, l.name, l.phone10, l.source, l.campaign, l.status, l.current_code, l.attempts,
  l.last_contacted_at, l.next_followup_at, l.created_at, l.amount, l.tags, l.has_guitar,
  CASE WHEN l.locked_until > NOW() THEN k.name END AS locked_by_name,
  CASE WHEN l.locked_until > NOW() THEN l.locked_by END AS locked_by,
  cb.name AS callback_set_by_name, l.assigned_to, asg.name AS assigned_to_name,
  (SELECT json_build_object('id', c.id, 'duration_secs', c.duration_secs, 'called_at', c.called_at,
                            'has_audio', c.audio_storage_key IS NOT NULL)
   FROM calls c WHERE c.phone10 = l.phone10 ORDER BY c.called_at DESC LIMIT 1) AS last_call`;
export const LEAD_LIST_JOINS = `
  LEFT JOIN employees k ON k.id = l.locked_by
  LEFT JOIN employees cb ON cb.id = l.callback_set_by
  LEFT JOIN employees asg ON asg.id = l.assigned_to`;

const SECTION_CAP = 200;

export async function queue(user: User, f: Filters, now = new Date()) {
  // Only what the Leads page shows: follow-ups due now, overdue, or due later today (IST). New leads
  // are not loaded (thousands after the sheet import, and the page doesn't list them); their number
  // comes from the tiles. Retries/callbacks with no time (sheet import) live in All leads only.
  const values: unknown[] = [now];
  const where = [
    "l.status IN ('retry','callback')",
    `l.next_followup_at < GREATEST(
       ((($1::timestamptz AT TIME ZONE 'Asia/Kolkata')::date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata'),
       $1::timestamptz + make_interval(mins => ${DUE_WINDOW_MS / 60_000}))`,
    ...leadFilters(f, values, user.sub),
  ];
  const [{ rows }, { rows: [k] }] = await Promise.all([
    pool.query(`SELECT ${LEAD_LIST_COLS} FROM leads l ${LEAD_LIST_JOINS} WHERE ${where.join(" AND ")}`, values),
    // The four tiles on the Leads page: counts on indexed columns, no rows loaded
    pool.query(
      `SELECT
         (SELECT count(*) FROM leads)::int AS total,
         (SELECT count(*) FROM leads WHERE status = 'new')::int AS new_leads,
         (SELECT count(*) FROM leads WHERE status IN ('retry','callback')
            AND (next_followup_at AT TIME ZONE 'Asia/Kolkata')::date = (NOW() AT TIME ZONE 'Asia/Kolkata')::date)::int AS due_today,
         (SELECT count(*) FROM leads WHERE status = 'converted')::int AS converted`
    ),
  ]);
  const leads = rows.map((r) => ({ ...r, next_followup_at: r.next_followup_at && new Date(r.next_followup_at), created_at: new Date(r.created_at) }));
  leads.sort((a, b) => compareQueue(a, b, now));
  const sections: Record<QueueBucket, unknown[]> = { due_now: [], overdue: [], new: [], retry: [], later: [] };
  const counts: Record<QueueBucket, number> = { due_now: 0, overdue: 0, new: k.new_leads, retry: 0, later: 0 };
  for (const l of leads) {
    const b = bucketOf(l, now);
    counts[b]++;
    if (sections[b].length < SECTION_CAP) sections[b].push({ ...l, bucket: b });
  }
  return { server_now: now, counts, sections, kpis: { due_now: counts.due_now, overdue: counts.overdue, ...k } };
}

// ── Edit in the table (client, 8 Nov) ──────────────────────────────────────

export const leadPatchSchema = z.object({
  version: z.number().int().positive(),
  assigned_to: z.string().uuid().nullable().optional(),
  has_guitar: z.boolean().nullable().optional(),
  next_followup_at: z.string().datetime({ offset: true }).optional(),
  amount: z.number().positive().max(100000).nullable().optional(),
  last_contacted_at: z.string().datetime({ offset: true }).optional(),
}).refine((p) => Object.keys(p).some((k) => k !== "version" && p[k as keyof typeof p] !== undefined), "Nothing to change");
export type LeadPatch = z.infer<typeof leadPatchSchema>;

/**
 * Change Assigned to / Guitar / Amount / Last contacted / next follow-up from the Leads table without a call outcome.
 * Same guards as a save: version (409), someone else's lock (423). Leaves a line in the history.
 */
export async function updateLeadFields(leadId: string, user: User, p: LeadPatch, now = new Date()) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: [lead] } = await client.query(
      `SELECT l.status, l.version, l.locked_by, l.locked_until, u.name AS updated_by_name, k.name AS locked_by_name
       FROM leads l LEFT JOIN employees u ON u.id = l.updated_by LEFT JOIN employees k ON k.id = l.locked_by
       WHERE l.id = $1 FOR UPDATE OF l`,
      [leadId]
    );
    if (!lead) throw new CrmError(404, "Lead not found");
    if (lead.version !== p.version) {
      const who = lead.updated_by_name ?? "someone else";
      throw new CrmError(409, `This lead was updated by ${who}, reload`, { updated_by: who, version: lead.version });
    }
    if (lead.locked_by && lead.locked_by !== user.sub && new Date(lead.locked_until) > now) {
      throw new CrmError(423, `${lead.locked_by_name} is on this lead`, { locked_by: lead.locked_by_name });
    }
    const notes: string[] = [];
    const sets: string[] = [];
    const values: unknown[] = [leadId];
    const set = (col: string, v: unknown) => { values.push(v); sets.push(`${col} = $${values.length}`); };
    if (p.assigned_to !== undefined) {
      const { rows: [e] } = p.assigned_to
        ? await client.query("SELECT name FROM employees WHERE id = $1 AND status = 'active'", [p.assigned_to])
        : { rows: [{ name: "nobody" }] };
      if (!e) throw new CrmError(400, "That representative is not active");
      set("assigned_to", p.assigned_to);
      notes.push(`Assigned to ${e.name}`);
    }
    if (p.has_guitar !== undefined) {
      set("has_guitar", p.has_guitar);
      notes.push(`Guitar: ${p.has_guitar == null ? "not set" : p.has_guitar ? "Yes" : "No"}`);
    }
    if (p.next_followup_at !== undefined) {
      if (!["retry", "callback"].includes(lead.status)) throw new CrmError(400, "Set a status with a follow-up first");
      const at = new Date(p.next_followup_at);
      if (at.getTime() < now.getTime() - 60_000) throw new CrmError(400, "The follow-up time is in the past");
      if (at.getTime() > now.getTime() + 90 * 86_400_000) throw new CrmError(400, "The follow-up is more than 90 days away");
      set("next_followup_at", at);
      notes.push(`Next follow-up ${at.toLocaleString("en-GB", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: true })}`);
    }
    if (p.amount !== undefined) {
      set("amount", p.amount);
      notes.push(`Amount: ${p.amount == null ? "not set" : `₹${p.amount}`}`);
    }
    if (p.last_contacted_at !== undefined) {
      const at = new Date(p.last_contacted_at);
      if (at.getTime() > now.getTime() + 60_000) throw new CrmError(400, "Last contacted can't be in the future");
      set("last_contacted_at", at);
      notes.push(`Last contacted ${at.toLocaleString("en-GB", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: true })}`);
    }
    const { rows: [saved] } = await client.query(
      `UPDATE leads SET ${sets.join(", ")}, version = version + 1, updated_by = $${values.length + 1}, updated_at = NOW()
       WHERE id = $1 RETURNING version`,
      [...values, user.sub]
    );
    await client.query(
      "INSERT INTO lead_interactions (lead_id, employee_id, kind, note) VALUES ($1, $2, 'system', $3)",
      [leadId, user.sub, `Changed in the table: ${notes.join(" · ")}`]
    );
    await client.query("COMMIT");
    return { version: saved.version };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

// ── Lead intake ────────────────────────────────────────────────────────────

export const ingestRowSchema = z.object({
  external_id: z.coerce.string().trim().min(1).max(150).nullish(),
  name: z.string().trim().max(150).nullish(),
  phone: z.coerce.string().trim().min(1).max(40),
  email: z.string().trim().max(200).nullish(),
  source: z.string().trim().max(60).nullish(),
  campaign: z.string().trim().max(150).nullish(),
  created_at: z.string().trim().max(40).nullish(),
  // The sheet's own columns, when it has them (old rows already worked by the reps)
  status: z.coerce.string().trim().max(20).nullish(),
  rep: z.coerce.string().trim().max(80).nullish(),
  amount: z.coerce.string().trim().max(20).nullish(),
  guitar: z.coerce.string().trim().max(10).nullish(),
  extra: z.record(z.unknown()).nullish(),
});
export const MAX_INGEST_ROWS = 500;

export type IngestResult = { index: number; external_id: string | null; result: "created" | "duplicate" | "reenquired" | "invalid" | "error"; lead_code?: string; error?: string };

async function externalIdKnown(client: PoolClient, id: string): Promise<boolean> {
  const { rows } = await client.query(
    `SELECT 1 FROM leads WHERE external_id = $1
     UNION ALL SELECT 1 FROM lead_interactions WHERE kind = 'reenquiry' AND meta ->> 'external_id' = $1 LIMIT 1`,
    [id]
  );
  return rows.length > 0;
}

/**
 * Idempotent intake. Same external_id → skipped. Same number as an existing lead
 * → that lead is reopened and tagged "re-enquired" (no duplicate). Each row runs
 * in its own transaction so one bad row never loses the others.
 */
export async function ingestRows(input: unknown[], now = new Date()): Promise<IngestResult[]> {
  const out: IngestResult[] = [];
  const [codes, reps] = await Promise.all([
    getCodes(),
    pool.query("SELECT id, name FROM employees WHERE role = 'employee' AND status = 'active'").then((r) => r.rows as { id: string; name: string }[]),
  ]);
  for (const [index, raw] of input.entries()) {
    const parsed = ingestRowSchema.safeParse(raw);
    const extId = parsed.success ? parsed.data.external_id ?? null : null;
    if (!parsed.success) { out.push({ index, external_id: extId, result: "invalid", error: parsed.error.issues[0]?.message }); continue; }
    const row = parsed.data;
    const p10 = phone10(row.phone);
    if (!isFullPhone10(p10)) { out.push({ index, external_id: extId, result: "invalid", error: "Phone needs 10 digits" }); continue; }

    const letter = (row.status ?? "").trim().toUpperCase();
    if (CODE_RE.test(letter) && !codes[letter]) await addUnknownCode(codes, letter);
    const sheet = fromSheet(row, codes, reps);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      if (extId && await externalIdKnown(client, extId)) {
        await client.query("ROLLBACK");
        out.push({ index, external_id: extId, result: "duplicate" });
        continue;
      }
      const existing = await client.query("SELECT id, lead_code, status FROM leads WHERE phone10 = $1 FOR UPDATE", [p10]);
      if (existing.rows[0]) {
        const l = existing.rows[0];
        await client.query(
          `INSERT INTO lead_interactions (lead_id, kind, note, meta) VALUES ($1, 'reenquiry', $2, $3)`,
          [l.id, `Re-enquired via ${row.source || "intake"}${row.campaign ? ` · ${row.campaign}` : ""}`,
           JSON.stringify({ external_id: extId, name: row.name, source: row.source, campaign: row.campaign, row: raw })]
        );
        // A paid student stays converted; everyone else goes back to the top of New, or takes the
        // status the sheet row already has
        await client.query(
          `UPDATE leads SET tags = CASE WHEN 're-enquired' = ANY(tags) THEN tags ELSE array_append(tags, 're-enquired') END,
             current_code = CASE WHEN status = 'converted' OR $3::text IS NULL THEN current_code ELSE $3 END,
             status = CASE WHEN status = 'converted' THEN status ELSE COALESCE($2, 'new') END,
             next_followup_at = CASE WHEN status = 'converted' THEN next_followup_at END,
             attempts = CASE WHEN status = 'converted' THEN attempts ELSE 0 END,
             assigned_to = COALESCE($4, assigned_to), has_guitar = COALESCE($5, has_guitar), amount = COALESCE($6, amount),
             version = version + 1, updated_by = NULL, updated_at = NOW()
           WHERE id = $1`,
          [l.id, sheet.status, sheet.code, sheet.assigned_to, sheet.has_guitar, sheet.amount]
        );
        await client.query("COMMIT");
        out.push({ index, external_id: extId, result: "reenquired", lead_code: l.lead_code });
        continue;
      }
      const created = row.created_at ? new Date(row.created_at) : null;
      const createdAt = created && !Number.isNaN(created.getTime()) && created <= now ? created : now;
      const { rows: [l] } = await client.query(
        `INSERT INTO leads (name, email, phone_raw, phone10, source, campaign, external_id, raw, created_at,
                            status, current_code, assigned_to, has_guitar, amount)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, COALESCE($10, 'new'), $11, $12, $13, $14) RETURNING id, lead_code`,
        [row.name || "", row.email || null, row.phone, p10, row.source || null, row.campaign || null, extId,
         JSON.stringify(raw), createdAt, sheet.status, sheet.code, sheet.assigned_to, sheet.has_guitar, sheet.amount]
      );
      if (sheet.code) {
        await client.query(
          "INSERT INTO lead_interactions (lead_id, kind, code, note) VALUES ($1, 'system', $2, $3)",
          [l.id, sheet.code, `Status ${sheet.code} · ${codes[sheet.code].label} from the lead sheet`]
        );
      }
      await client.query("UPDATE calls SET lead_id = $1 WHERE phone10 = $2 AND lead_id IS NULL", [l.id, p10]);
      await client.query("COMMIT");
      out.push({ index, external_id: extId, result: "created", lead_code: l.lead_code });
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      out.push({ index, external_id: extId, result: "error", error: (e as Error).message.slice(0, 200) });
    } finally {
      client.release();
    }
  }
  return out;
}

/** Status, rep, guitar and amount a sheet row already has. Unknown values are left empty. */
function fromSheet(row: z.infer<typeof ingestRowSchema>, codes: CodeSettings, reps: { id: string; name: string }[]) {
  // One letter = a code (unknown ones were just added to Settings); anything else ("NA", "1") is ignored
  const letter = (row.status ?? "").trim().toUpperCase();
  const code = CODE_RE.test(letter) && codes[letter] ? letter : null;
  const role = code ? codes[code].role : null;
  // Sheet → CallFlow rep: full name, else first name ("SHIVANI" → Shivani Jha), else the only first
  // name starting with it ("Raman" → Ramandeep Kaur)
  const who = (row.rep ?? "").toLowerCase();
  const first = (r: { name: string }) => r.name.toLowerCase().split(/\s+/)[0];
  const starts = who.length >= 3 ? reps.filter((r) => first(r).startsWith(who)) : [];
  const rep = who ? reps.find((r) => r.name.toLowerCase() === who) ?? reps.find((r) => first(r) === who) ?? (starts.length === 1 ? starts[0] : undefined) : undefined;
  const g = (row.guitar ?? "").toLowerCase();
  const amount = Number(row.amount);
  return {
    code, status: role ? STATUS_OF_ROLE[role] : null, assigned_to: rep?.id ?? null,
    has_guitar: g === "yes" || g === "y" ? true : g === "no" || g === "n" ? false : null,
    // The sheet shows the trial price on every row; it only means money for a converted lead
    amount: role === "paid" && amount > 0 ? amount : null,
  };
}

/** The external_ids from one day's sheet that the server has never seen. */
export async function reconcile(ids: string[]): Promise<string[]> {
  const { rows } = await pool.query(
    `SELECT x FROM unnest($1::text[]) x
     WHERE NOT EXISTS (SELECT 1 FROM leads WHERE external_id = x)
       AND NOT EXISTS (SELECT 1 FROM lead_interactions WHERE kind = 'reenquiry' AND meta ->> 'external_id' = x)`,
    [ids]
  );
  return rows.map((r) => r.x);
}
