import type { PoolClient } from "pg";
import { z } from "zod";
import pool from "../db/pool";
import { IST_TODAY_START } from "../lib/dateRange";
import { isFullPhone10, phone10 } from "../lib/crm/phone";
import { bucketOf, compareQueue, type QueueBucket } from "../lib/crm/queue";
import {
  DEFAULT_RETRY, KEEP_AUDIO_CODES, PERMISSIONS, TALKED_CODES, nextState, validateOutcome,
  type OutcomeInput, type Permission, type RetryRules,
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
export async function linkNearestCall(client: PoolClient, interactionId: string, p10: string, employeeId: string, at: Date, code: string | null) {
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
        [callId, interactionId, !!code && (KEEP_AUDIO_CODES as readonly string[]).includes(code)]
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
  const problem = validateOutcome(input, now);
  if (problem) throw new CrmError(400, problem);
  const rules = await getSetting<RetryRules>("retry_rules", DEFAULT_RETRY);

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

    const s = nextState(lead.attempts, input, rules, now);
    const answers = input.answers.length ? input.answers : lead.answers;
    const { rows: [ix] } = await client.query(
      `INSERT INTO lead_interactions (lead_id, employee_id, kind, code, reason, note, answers, next_followup_at, meta)
       VALUES ($1, $2, 'call_outcome', $3, $4, $5, $6, $7, $8) RETURNING id, created_at`,
      [leadId, user.sub, input.code, input.reason || null, input.note || null, JSON.stringify(input.answers),
       s.next_followup_at, JSON.stringify({ status: s.status, attempts: s.attempts, student_set_time: !!input.student_set_time, amount: s.amount, assigned_to: input.assigned_to ?? null })]
    );
    const { rows: [saved] } = await client.query(
      `UPDATE leads SET status = $2::text, current_code = $3, next_followup_at = $4, attempts = $5,
         amount = COALESCE($6, amount), answers = $7,
         callback_set_by = CASE WHEN $2::text = 'callback' THEN $8::uuid END,
         student_set_time = ($2::text = 'callback' AND $9::boolean),
         last_contacted_at = NOW(), version = version + 1, updated_by = $8, updated_at = NOW(),
         locked_by = NULL, locked_until = NULL,
         assigned_to = CASE WHEN $2::text = 'callback' THEN COALESCE($10::uuid, $8::uuid) ELSE assigned_to END
       WHERE id = $1 RETURNING version`,
      [leadId, s.status, s.current_code, s.next_followup_at, s.attempts, s.amount, JSON.stringify(answers), user.sub, !!input.student_set_time, input.assigned_to ?? null]
    );
    const callId = await linkNearestCall(client, ix.id, lead.phone10, user.sub, new Date(ix.created_at), input.code);
    await client.query("COMMIT");
    return { version: saved.version as number, interaction_id: ix.id as string, call_id: callId, status: s.status };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

/** Owner: bring a Dropped lead back into the queue as a retry due now. */
export async function reviveLead(leadId: string, user: User) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rowCount } = await client.query(
      `UPDATE leads SET status = 'retry', attempts = 0, next_followup_at = NOW(), version = version + 1,
         updated_by = $2, updated_at = NOW() WHERE id = $1 AND status = 'dropped'`,
      [leadId, user.sub]
    );
    if (!rowCount) throw new CrmError(400, "Only a Dropped lead can be revived");
    await client.query(
      `INSERT INTO lead_interactions (lead_id, employee_id, kind, note) VALUES ($1, $2, 'system', 'Revived from Dropped')`,
      [leadId, user.sub]
    );
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

// ── Lead detail + history ──────────────────────────────────────────────────

const NOT_TALKING = ["busy", "no_answer", "switched_off", "invalid_number"];

/** A rep's code that disagrees with the automatic call check (e.g. D saved on a "busy" call). */
export function contradicts(code: string | null, check: string | null): boolean {
  if (!code || !check) return false;
  if ((TALKED_CODES as readonly string[]).includes(code)) return NOT_TALKING.includes(check);
  return (code === "A" || code === "B") && check === "possible_conversation";
}

async function callCheckOn(): Promise<boolean> {
  const s = await getSetting<{ mode: string }>("call_check", { mode: "preview" });
  return s.mode !== "off";
}

export async function leadDetail(leadId: string) {
  const { rows: [lead] } = await pool.query(
    `SELECT l.id, l.lead_code, l.name, l.email, l.phone_raw, l.phone10, l.source, l.campaign, l.external_id,
            l.status, l.current_code, l.next_followup_at, l.student_set_time, l.attempts, l.last_contacted_at,
            l.amount, l.answers, l.tags, l.version, l.created_at, l.updated_at, l.locked_until,
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
  const checks = await callCheckOn();

  const [ixRes, callRes, links] = await Promise.all([
    pool.query(
      `SELECT i.id, i.kind, i.code, i.reason, i.note, i.answers, i.next_followup_at, i.call_id, i.meta, i.created_at,
              i.employee_id, e.name AS employee_name, t.label AS template_label
       FROM lead_interactions i
       LEFT JOIN employees e ON e.id = i.employee_id
       LEFT JOIN wati_templates t ON t.id = i.template_id
       WHERE i.lead_id = $1 ORDER BY i.created_at DESC`,
      [leadId]
    ),
    // Every recording of this number, by every rep — not scoped like /calls/search
    pool.query(
      `SELECT c.id, c.called_at, c.duration_secs, c.call_direction, c.employee_id, e.name AS employee_name,
              c.audio_storage_key, c.keep_audio, cc.label AS check_label, cc.confidence AS check_confidence
       FROM calls c
       LEFT JOIN employees e ON e.id = c.employee_id
       LEFT JOIN call_checks cc ON cc.call_id = c.id
       WHERE c.phone10 = $1 ORDER BY c.called_at DESC LIMIT 200`,
      [lead.phone10]
    ),
    getSetting<Record<string, string>>("links", {}),
  ]);

  const expiredBefore = Date.now() - RETENTION_DAYS * 86_400_000;
  const calls = await Promise.all(callRes.rows.map(async (c) => {
    const audio = c.audio_storage_key ? await audioUrlsFor(c.id, c.audio_storage_key) : null;
    return {
      id: c.id, called_at: c.called_at, duration_secs: c.duration_secs, direction: c.call_direction,
      employee_id: c.employee_id, employee_name: c.employee_name, keep_audio: c.keep_audio,
      check: checks && c.check_label ? { label: c.check_label, confidence: c.check_confidence } : null,
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
    return {
      type: "interaction", at: i.created_at, ...i, call,
      contradiction: call?.check ? contradicts(i.code, call.check.label) : false,
    };
  });
  for (const c of calls) if (!linked.has(c.id)) timeline.push({ type: "call", at: c.called_at, call: c });
  timeline.sort((a, b) => new Date(b.at as string).getTime() - new Date(a.at as string).getTime());

  const followup = lead.next_followup_at ? new Date(lead.next_followup_at) : null;
  const istFmt = (d: Date, o: Intl.DateTimeFormatOptions) => d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", ...o });
  const waVars: Record<string, string> = {
    name: lead.name.split(/\s+/)[0] || "there",
    amount: String(lead.amount ?? 299),
    date: followup ? istFmt(followup, { day: "numeric", month: "short" }) : "",
    time: followup ? istFmt(followup, { hour: "numeric", minute: "2-digit", hour12: true }) : "",
    payment_link: links.payment_link ?? "",
    class_link: links.class_link ?? "",
  };

  const lastCallback = ixRes.rows.find((i) => i.code === "D" || i.code === "E");
  return { lead, timeline, wa_vars: waVars, callback_note: lastCallback ? (lastCallback.note ?? lastCallback.reason) : null, server_now: new Date() };
}

// ── Queue ──────────────────────────────────────────────────────────────────

export const queueFilterSchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.string().max(20).optional(),
  code: z.string().max(1).optional(),
  campaign: z.string().max(150).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
type Filters = z.infer<typeof queueFilterSchema>;

/** WHERE fragments shared by the queue, the All Leads table and the CSV export. */
export function leadFilters(f: Filters, values: unknown[]): string[] {
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
  return where;
}

export const LEAD_LIST_COLS = `
  l.id, l.lead_code, l.name, l.phone10, l.source, l.campaign, l.status, l.current_code, l.attempts,
  l.last_contacted_at, l.next_followup_at, l.created_at, l.amount, l.tags, l.student_set_time,
  CASE WHEN l.locked_until > NOW() THEN k.name END AS locked_by_name,
  CASE WHEN l.locked_until > NOW() THEN l.locked_by END AS locked_by,
  cb.name AS callback_set_by_name, asg.name AS assigned_to_name,
  (SELECT json_build_object('id', c.id, 'duration_secs', c.duration_secs, 'called_at', c.called_at,
                            'has_audio', c.audio_storage_key IS NOT NULL)
   FROM calls c WHERE c.phone10 = l.phone10 ORDER BY c.called_at DESC LIMIT 1) AS last_call`;
export const LEAD_LIST_JOINS = `
  LEFT JOIN employees k ON k.id = l.locked_by
  LEFT JOIN employees cb ON cb.id = l.callback_set_by
  LEFT JOIN employees asg ON asg.id = l.assigned_to`;

const SECTION_CAP = 200;

export async function queue(user: User, f: Filters, now = new Date()) {
  const values: unknown[] = [];
  const where = ["l.status IN ('new','retry','callback')", ...leadFilters(f, values)];
  const { rows } = await pool.query(
    `SELECT ${LEAD_LIST_COLS},
       (SELECT coalesce(i.note, i.reason) FROM lead_interactions i
        WHERE i.lead_id = l.id AND i.code IN ('D','E') ORDER BY i.created_at DESC LIMIT 1) AS callback_note
     FROM leads l ${LEAD_LIST_JOINS} WHERE ${where.join(" AND ")}`,
    values
  );
  const leads = rows.map((r) => ({ ...r, next_followup_at: r.next_followup_at && new Date(r.next_followup_at), created_at: new Date(r.created_at) }));
  leads.sort((a, b) => compareQueue(a, b, now));
  const sections: Record<QueueBucket, unknown[]> = { due_now: [], overdue: [], new: [], retry: [], later: [] };
  for (const l of leads) {
    const b = bucketOf(l, now);
    if (sections[b].length < SECTION_CAP) sections[b].push({ ...l, bucket: b });
  }
  const counts = Object.fromEntries(Object.entries(sections).map(([k]) => [k, leads.filter((l) => bucketOf(l, now) === k).length]));

  const { rows: [k] } = await pool.query(
    `SELECT
       (SELECT count(*) FROM leads WHERE created_at >= ${IST_TODAY_START})::int AS new_today,
       (SELECT count(*) FROM lead_interactions WHERE code = 'F' AND created_at >= ${IST_TODAY_START})::int AS converted_today,
       (SELECT count(*) FROM calls WHERE employee_id = $1 AND called_at >= ${IST_TODAY_START})::int AS my_calls_today`,
    [user.sub]
  );
  return { server_now: now, counts, sections, kpis: { due_now: counts.due_now, overdue: counts.overdue, ...k } };
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
  for (const [index, raw] of input.entries()) {
    const parsed = ingestRowSchema.safeParse(raw);
    const extId = parsed.success ? parsed.data.external_id ?? null : null;
    if (!parsed.success) { out.push({ index, external_id: extId, result: "invalid", error: parsed.error.issues[0]?.message }); continue; }
    const row = parsed.data;
    const p10 = phone10(row.phone);
    if (!isFullPhone10(p10)) { out.push({ index, external_id: extId, result: "invalid", error: "Phone needs 10 digits" }); continue; }

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
        // A paid student stays converted; everyone else goes back to the top of New
        await client.query(
          `UPDATE leads SET tags = CASE WHEN 're-enquired' = ANY(tags) THEN tags ELSE array_append(tags, 're-enquired') END,
             status = CASE WHEN status = 'converted' THEN status ELSE 'new' END,
             next_followup_at = CASE WHEN status = 'converted' THEN next_followup_at END,
             attempts = CASE WHEN status = 'converted' THEN attempts ELSE 0 END,
             version = version + 1, updated_by = NULL, updated_at = NOW()
           WHERE id = $1`,
          [l.id]
        );
        await client.query("COMMIT");
        out.push({ index, external_id: extId, result: "reenquired", lead_code: l.lead_code });
        continue;
      }
      const created = row.created_at ? new Date(row.created_at) : null;
      const createdAt = created && !Number.isNaN(created.getTime()) && created <= now ? created : now;
      const { rows: [l] } = await client.query(
        `INSERT INTO leads (name, email, phone_raw, phone10, source, campaign, external_id, raw, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id, lead_code`,
        [row.name || "", row.email || null, row.phone, p10, row.source || null, row.campaign || null, extId,
         JSON.stringify(raw), createdAt]
      );
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
