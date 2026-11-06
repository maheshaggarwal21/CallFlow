import { createHash, randomInt, timingSafeEqual } from "crypto";
import { NextFunction, Request, Response, Router } from "express";
import { z, type ZodTypeAny } from "zod";
import pool from "../db/pool";
import { requireAuth } from "../middleware/auth";
import { requireOwner } from "../middleware/requireOwner";
import { requirePermission } from "../middleware/requirePermission";
import { resolveRange } from "../lib/dateRange";
import { CODES, PERMISSIONS, outcomeSchema } from "../lib/crm/rules";
import {
  CrmError, LEAD_LIST_COLS, assignLeads, LEAD_LIST_JOINS, MAX_INGEST_ROWS, claimLock, getSetting, ingestRows, leadDetail, leadFilters,
  permissionsOf, queue, queueFilterSchema, reconcile, releaseLock, reviveLead, saveOutcome,
} from "../services/crm.service";
import { crmReport, digestData, digestHtml, linkPair } from "../services/crmReports.service";
import { fillTemplate, sendWhatsAppTemplate, watiMode } from "../services/wati.service";
import { audioUrlsFor } from "../services/audioUrls";

// Mounted at /api/v1/crm only when CRM_ENABLED=true (see index.ts).
const router = Router();

function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const r = schema.safeParse(data);
  if (r.success) return r.data;
  const i = r.error.issues[0];
  throw new CrmError(400, i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message);
}

const uuid = z.string().uuid();
const user = (req: Request) => req.user! as { sub: string; role: "owner" | "employee"; name: string };

// ── Lead intake (Apps Script), shared secret instead of a login ────────────

function requireIngestSecret(req: Request, res: Response, next: NextFunction) {
  const secret = process.env.CRM_INGEST_SECRET ?? "";
  if (secret.length < 32) {
    return res.status(503).json({ error: "Lead intake is not configured", message: "Lead intake is not configured" });
  }
  // Hash both sides so the compare is constant-time whatever the given length
  const given = createHash("sha256").update(String(req.get("X-CRM-Secret") ?? "")).digest();
  if (!timingSafeEqual(given, createHash("sha256").update(secret).digest())) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  return next();
}

router.post("/leads/ingest", requireIngestSecret, async (req, res) => {
  const rows = parse(z.array(z.unknown()).min(1).max(MAX_INGEST_ROWS), req.body);
  return res.json({ results: await ingestRows(rows) });
});

router.post("/leads/reconcile", requireIngestSecret, async (req, res) => {
  const body = parse(z.object({ external_ids: z.array(z.coerce.string().trim().min(1).max(150)).max(5000) }), req.body);
  const missing = await reconcile(body.external_ids);
  return res.json({ checked: body.external_ids.length, missing });
});

// ── Everything else needs a login ───────────────────────────────────────────

router.use(requireAuth);

router.get("/me", async (req, res) => {
  return res.json({ permissions: await permissionsOf(user(req)), is_owner: user(req).role === "owner" });
});

/** Lists the lead drawer needs: active questions, reasons, note templates, WhatsApp templates. */
router.get("/config", async (_req, res) => {
  const [q, r, t, w, retry, reps] = await Promise.all([
    pool.query("SELECT id, label, type, options FROM lead_questions WHERE active ORDER BY sort_order, created_at"),
    pool.query("SELECT id, label, codes FROM lead_reasons WHERE active ORDER BY sort_order, created_at"),
    pool.query("SELECT id, label, text, codes, category FROM note_templates WHERE active ORDER BY sort_order, created_at"),
    pool.query("SELECT id, name, label, body FROM wati_templates WHERE active ORDER BY sort_order, created_at"),
    getSetting("retry_rules", {}),
    pool.query("SELECT id, name FROM employees WHERE role = 'employee' AND status = 'active' ORDER BY name"),
  ]);
  return res.json({ questions: q.rows, reasons: r.rows, note_templates: t.rows, wati_templates: w.rows, retry_rules: retry, wati_mode: watiMode(), reps: reps.rows });
});

router.get("/queue", async (req, res) => {
  return res.json(await queue(user(req), parse(queueFilterSchema, req.query)));
});

const SORTS: Record<string, string> = {
  created_at: "l.created_at", next_followup_at: "l.next_followup_at", last_contacted_at: "l.last_contacted_at",
  attempts: "l.attempts", lead_code: "l.lead_code", name: "l.name", status: "l.status",
};
const listSchema = queueFilterSchema.extend({
  sort: z.enum(Object.keys(SORTS) as [string, ...string[]]).default("created_at"),
  dir: z.enum(["asc", "desc"]).default("desc"),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

router.get("/leads", async (req, res) => {
  const f = parse(listSchema, req.query);
  const values: unknown[] = [];
  const where = leadFilters(f, values, user(req).sub);
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const [list, count] = await Promise.all([
    pool.query(
      `SELECT ${LEAD_LIST_COLS} FROM leads l ${LEAD_LIST_JOINS} ${w}
       ORDER BY ${SORTS[f.sort]} ${f.dir} NULLS LAST, l.created_at DESC LIMIT ${f.limit} OFFSET ${f.offset}`,
      values
    ),
    pool.query(`SELECT count(*)::int AS n FROM leads l ${w}`, values),
  ]);
  return res.json({ data: list.rows, total: count.rows[0].n, limit: f.limit, offset: f.offset });
});

// Spreadsheet apps run cells starting with these as formulas
const csvCell = (v: unknown) => {
  let s = v == null ? "" : v instanceof Date ? v.toISOString() : Array.isArray(v) ? v.join("; ") : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
};

router.get("/leads/export.csv", requirePermission("export_leads"), async (req, res) => {
  const f = parse(listSchema, req.query);
  const values: unknown[] = [];
  const where = leadFilters(f, values, user(req).sub);
  const { rows } = await pool.query(
    `SELECT l.lead_code, l.name, l.phone10, l.email, l.source, l.campaign, l.status, l.current_code, l.attempts,
            l.last_contacted_at, l.next_followup_at, l.amount, l.tags, l.created_at, a.name AS assigned_to
     FROM leads l LEFT JOIN employees a ON a.id = l.assigned_to ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY ${SORTS[f.sort]} ${f.dir} NULLS LAST LIMIT 50000`,
    values
  );
  const cols = ["lead_code", "name", "phone10", "email", "source", "campaign", "status", "current_code", "assigned_to", "attempts", "last_contacted_at", "next_followup_at", "amount", "tags", "created_at"];
  res.type("text/csv").set("Content-Disposition", `attachment; filename="leads.csv"`);
  return res.send([cols.join(","), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(","))].join("\n"));
});

router.post("/leads/assign", requirePermission("reassign_leads"), async (req, res) => {
  const b = parse(z.object({ lead_ids: z.array(uuid).min(1).max(500), employee_id: uuid.nullable() }), req.body);
  return res.json(await assignLeads(b.lead_ids, b.employee_id, user(req)));
});

router.get("/leads/:id", async (req, res) => {
  return res.json(await leadDetail(parse(uuid, req.params.id)));
});

router.post("/leads/:id/lock", async (req, res) => {
  return res.json(await claimLock(parse(uuid, req.params.id), user(req).sub));
});

router.delete("/leads/:id/lock", async (req, res) => {
  await releaseLock(parse(uuid, req.params.id), user(req).sub);
  return res.status(204).end();
});

router.post("/leads/:id/outcome", async (req, res) => {
  return res.json(await saveOutcome(parse(uuid, req.params.id), user(req), parse(outcomeSchema, req.body)));
});

router.post("/leads/:id/revive", requirePermission("reassign_leads"), async (req, res) => {
  await reviveLead(parse(uuid, req.params.id), user(req));
  return res.status(204).end();
});

router.post("/leads/:id/whatsapp", async (req, res) => {
  const leadId = parse(uuid, req.params.id);
  const { template_id } = parse(z.object({ template_id: uuid }), req.body);
  const { rows: [t] } = await pool.query("SELECT id, name, label, body FROM wati_templates WHERE id = $1 AND active", [template_id]);
  if (!t) throw new CrmError(404, "Template not found");
  const detail = await leadDetail(leadId);
  const sent = await sendWhatsAppTemplate({ phone10: detail.lead.phone10, template: t.name, body: t.body, vars: detail.wa_vars });
  await pool.query(
    `INSERT INTO lead_interactions (lead_id, employee_id, kind, template_id, note, meta) VALUES ($1, $2, 'whatsapp', $3, $4, $5)`,
    [leadId, user(req).sub, t.id, fillTemplate(t.body, detail.wa_vars), JSON.stringify({ mode: sent.mode, message_id: sent.message_id })]
  );
  return res.json({ mode: sent.mode, template: t.label });
});

/** Playback for one recording of a LEAD's number (any rep), e.g. the queue row's play button. */
router.get("/calls/:id/audio", async (req, res) => {
  const id = parse(uuid, req.params.id);
  const { rows: [c] } = await pool.query(
    "SELECT c.audio_storage_key FROM calls c JOIN leads l ON l.phone10 = c.phone10 WHERE c.id = $1",
    [id]
  );
  if (!c) throw new CrmError(404, "Recording not found for a lead");
  return res.json(await audioUrlsFor(id, c.audio_storage_key));
});

/** Owner: star / unstar a recording so retention never deletes it. */
router.post("/calls/:id/keep", requireOwner, async (req, res) => {
  const { keep } = parse(z.object({ keep: z.boolean() }), req.body);
  const r = await pool.query("UPDATE calls SET keep_audio = $2 WHERE id = $1 AND phone10 IS NOT NULL RETURNING keep_audio", [parse(uuid, req.params.id), keep]);
  if (!r.rows[0]) throw new CrmError(404, "Call not found");
  return res.json(r.rows[0]);
});

// ── Owner reports ──────────────────────────────────────────────────────────

router.get("/reports", requirePermission("view_crm_reports"), async (req, res) => {
  const { start, end } = resolveRange(String(req.query.date_from ?? "") || null, String(req.query.date_to ?? "") || null);
  return res.json({ ...(await crmReport(start, end)), range: { start, end } });
});

router.post("/mismatches/link", requirePermission("view_crm_reports"), async (req, res) => {
  const b = parse(z.object({ interaction_id: uuid, call_id: uuid }), req.body);
  await linkPair(b.interaction_id, b.call_id);
  return res.status(204).end();
});

router.get("/digest/preview", requirePermission("view_crm_reports"), async (req, res) => {
  const date = typeof req.query.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date) ? new Date(`${req.query.date}T12:00:00+05:30`) : new Date();
  return res.type("html").send(digestHtml(await digestData(date)));
});

// ── Settings ───────────────────────────────────────────────────────────────

router.get("/settings", async (req, res) => {
  const u = user(req);
  const [q, r, t, w, s, team] = await Promise.all([
    pool.query("SELECT * FROM lead_questions ORDER BY sort_order, created_at"),
    pool.query("SELECT * FROM lead_reasons ORDER BY sort_order, created_at"),
    pool.query("SELECT * FROM note_templates ORDER BY sort_order, created_at"),
    pool.query("SELECT id, name, label, body, active FROM wati_templates ORDER BY sort_order"),
    pool.query("SELECT key, value, updated_at FROM crm_settings"),
    u.role === "owner"
      ? pool.query(
          `SELECT e.id, e.name, e.email, e.employee_code,
                  coalesce(array_agg(p.permission ORDER BY p.permission) FILTER (WHERE p.permission IS NOT NULL), '{}') AS permissions
           FROM employees e LEFT JOIN employee_permissions p ON p.employee_id = e.id
           WHERE e.role = 'employee' AND e.status = 'active' GROUP BY e.id ORDER BY e.name`)
      : Promise.resolve({ rows: null }),
  ]);
  return res.json({
    questions: q.rows, reasons: r.rows, note_templates: t.rows, wati_templates: w.rows,
    values: Object.fromEntries(s.rows.map((x) => [x.key, x.value])),
    team: team.rows, permissions: await permissionsOf(u), wati_mode: watiMode(), all_permissions: PERMISSIONS,
  });
});

const questionSchema = z.object({
  label: z.string().trim().min(1).max(150),
  type: z.enum(["yesno", "select", "text"]),
  options: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  sort_order: z.number().int().min(0).max(999).default(0),
  active: z.boolean().default(true),
});
const codesSchema = z.array(z.enum(CODES)).min(1);
const reasonSchema = z.object({ label: z.string().trim().min(1).max(100), codes: codesSchema, sort_order: z.number().int().min(0).max(999).default(0), active: z.boolean().default(true) });
const templateSchema = z.object({
  label: z.string().trim().min(1).max(100), text: z.string().trim().min(1).max(1000), codes: codesSchema,
  category: z.string().trim().max(50).nullish(), sort_order: z.number().int().min(0).max(999).default(0), active: z.boolean().default(true),
});

/** Create + edit for an owner-managed list. There is no delete: deactivate instead. */
function listCrud(path: string, table: string, schema: z.AnyZodObject, perm: "manage_questions" | "manage_templates") {
  const cols = Object.keys(schema.shape);
  const json = (k: string, v: unknown) => (k === "options" ? JSON.stringify(v) : v);
  router.post(`/settings/${path}`, requirePermission(perm), async (req, res) => {
    const b = parse(schema, req.body);
    const { rows } = await pool.query(
      `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING *`,
      cols.map((c) => json(c, b[c]))
    );
    return res.status(201).json(rows[0]);
  });
  router.patch(`/settings/${path}/:id`, requirePermission(perm), async (req, res) => {
    const b = parse(schema.partial(), req.body);
    const keys = cols.filter((c) => b[c] !== undefined);
    if (!keys.length) throw new CrmError(400, "Nothing to change");
    const { rows } = await pool.query(
      `UPDATE ${table} SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")} WHERE id = $1 RETURNING *`,
      [parse(uuid, req.params.id), ...keys.map((k) => json(k, b[k]))]
    );
    if (!rows[0]) throw new CrmError(404, "Not found");
    return res.json(rows[0]);
  });
}
listCrud("questions", "lead_questions", questionSchema, "manage_questions");
listCrud("reasons", "lead_reasons", reasonSchema, "manage_templates");
listCrud("templates", "note_templates", templateSchema, "manage_templates");

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const retryRule = z.object({ hours: z.number().min(0.25).max(168).optional(), next_day_at: hhmm.optional() });
const VALUE_SCHEMAS: Record<string, ZodTypeAny> = {
  retry_rules: z.object({ A: retryRule, B: retryRule, C: retryRule, invalid: z.object({ never: z.boolean() }), max_attempts: z.number().int().min(1).max(50) }),
  digest: z.object({ send_time: hhmm, recipients: z.array(z.string().trim().email()).max(20) }),
  call_check: z.object({ mode: z.enum(["off", "preview"]) }),
  links: z.object({ payment_link: z.string().url().max(300), class_link: z.string().url().max(300) }),
};

router.patch("/settings/values/:key", requireOwner, async (req, res) => {
  const schema = VALUE_SCHEMAS[req.params.key];
  if (!schema) throw new CrmError(404, "Unknown setting");
  const value = parse(schema, req.body);
  await pool.query(
    `INSERT INTO crm_settings (key, value, updated_by, updated_at) VALUES ($1, $2, $3, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [req.params.key, JSON.stringify(value), user(req).sub]
  );
  return res.json(value);
});

router.put("/settings/team/:employeeId", requireOwner, async (req, res) => {
  const employeeId = parse(uuid, req.params.employeeId);
  const { permissions } = parse(z.object({ permissions: z.array(z.enum(PERMISSIONS)) }), req.body);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM employee_permissions WHERE employee_id = $1", [employeeId]);
    if (permissions.length) {
      await client.query(
        "INSERT INTO employee_permissions (employee_id, permission) SELECT $1, unnest($2::text[])",
        [employeeId, permissions]
      );
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  return res.json({ employee_id: employeeId, permissions });
});

// ── Dev only: show a lead arriving live in the demo ─────────────────────────

const FIRST = ["Aarav", "Diya", "Kabir", "Meera", "Rohan", "Saanvi", "Vihaan", "Anaya", "Ishaan", "Tara"];
const LAST = ["Sharma", "Verma", "Iyer", "Nair", "Gill", "Kapoor", "Joshi", "Bose"];
// Checked per request: at import time .env may not be loaded yet
router.post("/dev/simulate-lead", async (_req, res) => {
  if (process.env.NODE_ENV === "production") return res.status(404).json({ error: "Not found" });
  const name = `${FIRST[randomInt(FIRST.length)]} ${LAST[randomInt(LAST.length)]}`;
  const phone = `90000 1${String(randomInt(10000)).padStart(4, "0")}`; // clearly fake
  const [r] = await ingestRows([{ external_id: `demo-sim-${Date.now()}`, name, phone, source: "demo", campaign: "Demo · Simulated lead" }]);
  return res.json(r);
});

router.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (err instanceof CrmError) return res.status(err.status).json({ error: err.message, message: err.message, ...err.extra });
  return next(err);
});

export default router;
