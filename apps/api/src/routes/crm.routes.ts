import { createHash, randomInt, timingSafeEqual } from "crypto";
import { NextFunction, Request, Response, Router } from "express";
import { z, type ZodTypeAny } from "zod";
import pool from "../db/pool";
import { requireAuth } from "../middleware/auth";
import { requireOwner } from "../middleware/requireOwner";
import { fillTemplate, inboxUrl, listTemplates, sendTemplate, watiConfigured, watiDryRun } from "../services/wati.service";
import { requirePermission } from "../middleware/requirePermission";
import { CODE_RE, ROLES, outcomeSchema } from "../lib/crm/rules";
import {
  CrmError, LEAD_LIST_COLS, LEAD_LIST_JOINS, MAX_INGEST_ROWS, claimLock, getCodes, getSetting, ingestRows, leadDetail, leadFilters,
  leadPatchSchema, queue, queueFilterSchema, reapplyCodeRoles, reconcile, releaseLock, saveOutcome, updateLeadFields,
} from "../services/crm.service";
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
const user = (req: Request) => req.user! as { sub: string; role: "owner" | "admin" | "employee"; name: string };

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
// The Leads tab and everything on it; CRM Settings; export has its own permission
const leadsAccess = requirePermission("crm_leads");
const settingsAccess = requirePermission("crm_settings");

router.get("/me", async (req, res) => {
  // read fresh by requireAuth; the Super Admin has every permission without rows
  return res.json({ permissions: req.user!.permissions, is_owner: req.user!.role === "owner" });
});

/** What the lead form needs: the status codes, the representatives and the follow-up rules. */
router.get("/config", async (_req, res) => {
  const [retry, codes, reps] = await Promise.all([
    getSetting("retry_rules", {}), getCodes(),
    pool.query("SELECT id, name FROM employees WHERE role <> 'owner' AND status = 'active' ORDER BY name"),
  ]);
  return res.json({ retry_rules: retry, codes, reps: reps.rows });
});

router.get("/queue", leadsAccess, async (req, res) => {
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

router.get("/leads", leadsAccess, async (req, res) => {
  const f = parse(listSchema, req.query);
  const values: unknown[] = [];
  const where = leadFilters(f, values, user(req).sub);
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const [list, count] = await Promise.all([
    // Pick the page's ids first (cheap, filters use leads columns only), then build the full rows
    // (last call, rep names) for those 25 alone: deep pages no longer pay for every row they skip.
    // l.id breaks ties so both orderings agree and paging is stable.
    pool.query(
      `WITH page AS (
         SELECT l.id FROM leads l ${w}
         ORDER BY ${SORTS[f.sort]} ${f.dir} NULLS LAST, l.created_at DESC, l.id LIMIT ${f.limit} OFFSET ${f.offset})
       SELECT ${LEAD_LIST_COLS} FROM page JOIN leads l ON l.id = page.id ${LEAD_LIST_JOINS}
       ORDER BY ${SORTS[f.sort]} ${f.dir} NULLS LAST, l.created_at DESC, l.id`,
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

// Opens straight in Excel: UTF-8 marker (names in other scripts stay readable), IST dates as
// dd/mm/yyyy hh:mm, the status as the CRM shows it, plain headers.
// One shared formatter: building one per date (toLocaleString) cost ~0.5 s on 8k leads
const IST_FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kolkata", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
});
const istCsv = (d: unknown) => (d ? IST_FMT.format(new Date(d as string)).replace(",", "") : "");
const STATE_LABEL: Record<string, string> = { new: "New", dropped: "Dropped" };

router.get("/leads/export.csv", requirePermission("export_leads"), async (req, res) => {
  const f = parse(listSchema, req.query);
  const values: unknown[] = [];
  const where = leadFilters(f, values, user(req).sub);
  const [{ rows }, codes] = await Promise.all([
    pool.query(
      `SELECT l.lead_code, l.name, l.phone10, l.email, l.status, l.current_code, l.attempts, l.has_guitar,
              l.last_contacted_at, l.next_followup_at, l.amount, l.tags, l.created_at, a.name AS assigned_to
       FROM leads l LEFT JOIN employees a ON a.id = l.assigned_to ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY ${SORTS[f.sort]} ${f.dir} NULLS LAST, l.created_at DESC, l.id LIMIT 50000`,
      values
    ),
    getCodes(),
  ]);
  const status = (r: { status: string; current_code: string | null }) =>
    STATE_LABEL[r.status] ?? (r.current_code ? `${r.current_code} · ${codes[r.current_code]?.label ?? `Code ${r.current_code}`}` : r.status);
  const cols: [string, (r: Record<string, any>) => unknown][] = [
    ["Lead code", (r) => r.lead_code], ["Received (IST)", (r) => istCsv(r.created_at)], ["Name", (r) => r.name],
    ["Phone", (r) => r.phone10], ["Email", (r) => r.email], ["Status", (r) => status(r as never)],
    ["Assigned to", (r) => r.assigned_to], ["Guitar", (r) => (r.has_guitar == null ? "" : r.has_guitar ? "Yes" : "No")],
    ["Amount", (r) => (r.amount == null ? "" : Number(r.amount))], ["Attempts", (r) => r.attempts],
    ["Last contacted (IST)", (r) => istCsv(r.last_contacted_at)], ["Next follow-up (IST)", (r) => istCsv(r.next_followup_at)],
    ["Tags", (r) => r.tags],
  ];
  res.type("text/csv; charset=utf-8").set("Content-Disposition", `attachment; filename="leads.csv"`);
  return res.send("\uFEFF" + [cols.map(([h]) => csvCell(h)).join(","), ...rows.map((r) => cols.map(([, get]) => csvCell(get(r))).join(","))].join("\r\n"));
});

router.get("/leads/:id", leadsAccess, async (req, res) => {
  return res.json(await leadDetail(parse(uuid, req.params.id)));
});

router.post("/leads/:id/lock", leadsAccess, async (req, res) => {
  return res.json(await claimLock(parse(uuid, req.params.id), user(req).sub));
});

router.delete("/leads/:id/lock", leadsAccess, async (req, res) => {
  await releaseLock(parse(uuid, req.params.id), user(req).sub);
  return res.status(204).end();
});

router.patch("/leads/:id", leadsAccess, async (req, res) => {
  return res.json(await updateLeadFields(parse(uuid, req.params.id), user(req), parse(leadPatchSchema, req.body)));
});

router.post("/leads/:id/outcome", leadsAccess, async (req, res) => {
  return res.json(await saveOutcome(parse(uuid, req.params.id), user(req), parse(outcomeSchema, req.body)));
});

/** Playback for one recording of a LEAD's number (any rep), e.g. the queue row's play button. */
router.get("/calls/:id/audio", leadsAccess, async (req, res) => {
  const id = parse(uuid, req.params.id);
  const { rows: [c] } = await pool.query(
    "SELECT c.audio_storage_key FROM calls c JOIN leads l ON l.phone10 = c.phone10 WHERE c.id = $1",
    [id]
  );
  if (!c) throw new CrmError(404, "Recording not found for a lead");
  return res.json(await audioUrlsFor(id, c.audio_storage_key));
});

// ── WhatsApp through WATI ───────────────────────────────────────────────────

/** The approved templates for the lead form's dropdown. */
router.get("/wati/templates", leadsAccess, async (_req, res) => {
  if (!watiConfigured()) return res.json({ configured: false, dry_run: false, templates: [] });
  try {
    return res.json({ configured: true, dry_run: watiDryRun(), templates: await listTemplates() });
  } catch (e) {
    throw new CrmError(502, (e as Error).message);
  }
});

/** Send one approved template to the lead's number and note it in the lead's history. */
router.post("/leads/:id/whatsapp", leadsAccess, async (req, res) => {
  const leadId = parse(uuid, req.params.id);
  const body = parse(z.object({ template: z.string().min(1).max(200), values: z.record(z.string().max(60), z.string().trim().max(500)).default({}) }), req.body);
  const { rows: [lead] } = await pool.query("SELECT phone10 FROM leads WHERE id = $1", [leadId]);
  if (!lead) throw new CrmError(404, "Lead not found");
  let mode: "sent" | "dry-run";
  let text: string;
  try {
    const t = (await listTemplates()).find((x) => x.name === body.template);
    if (!t) throw new CrmError(404, "That template is no longer approved in WATI");
    const missing = t.params.find((x) => !body.values[x.name]);
    if (missing) throw new CrmError(400, `Fill in "${missing.name}" before sending`);
    mode = await sendTemplate(lead.phone10, t, body.values);
    text = fillTemplate(t.body, body.values);
  } catch (e) {
    if (e instanceof CrmError) throw e;
    throw new CrmError(502, (e as Error).message);
  }
  await pool.query(
    "INSERT INTO lead_interactions (lead_id, employee_id, kind, note, meta) VALUES ($1, $2, 'system', $3, $4)",
    [leadId, user(req).sub, `WhatsApp template "${body.template}" ${mode === "sent" ? "sent" : "previewed (test mode, not sent)"} by ${user(req).name}`,
      JSON.stringify({ whatsapp: { template: body.template, mode, text } })]
  );
  return res.json({ mode });
});

/** The address that opens this lead's chat in WATI. */
router.get("/leads/:id/wati-link", leadsAccess, async (req, res) => {
  const { rows: [lead] } = await pool.query("SELECT phone10 FROM leads WHERE id = $1", [parse(uuid, req.params.id)]);
  if (!lead) throw new CrmError(404, "Lead not found");
  const url = await inboxUrl(lead.phone10);
  if (!url) throw new CrmError(503, "WATI's inbox address is not set (WATI_INBOX_URL)");
  return res.json({ url });
});

/** Owner: star / unstar a recording so retention never deletes it. */
router.post("/calls/:id/keep", requireOwner, async (req, res) => {
  const { keep } = parse(z.object({ keep: z.boolean() }), req.body);
  const r = await pool.query("UPDATE calls SET keep_audio = $2 WHERE id = $1 AND phone10 IS NOT NULL RETURNING keep_audio", [parse(uuid, req.params.id), keep]);
  if (!r.rows[0]) throw new CrmError(404, "Call not found");
  return res.json(r.rows[0]);
});

// ── Settings ───────────────────────────────────────────────────────────────

router.get("/settings", settingsAccess, async (_req, res) => {
  const s = await pool.query("SELECT key, value, updated_at FROM crm_settings");
  return res.json({ values: Object.fromEntries(s.rows.map((x) => [x.key, x.value])) });
});

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const codeSetting = z.object({
  label: z.string().trim().min(1).max(40), role: z.enum(ROLES),
  hours: z.number().min(0.25).max(168).optional(), next_day_at: hhmm.optional(),
  description: z.string().trim().max(80).optional(),
  color: z.string().regex(/^#[0-9a-f]{6}$/i, "Colour must look like #a1b2c3").optional(),
}).refine((c) => c.role !== "other" || !!c.description, "Write what an \"Other\" status does");
const VALUE_SCHEMAS: Record<string, ZodTypeAny> = {
  retry_rules: z.object({ invalid: z.object({ never: z.boolean() }), max_attempts: z.number().int().min(0).max(50) }), // 0 = never drop
  codes: z.record(z.string().regex(CODE_RE, "Code must be one capital letter"), codeSetting)
    .refine((v) => Object.keys(v).length >= 1, "At least one status"),
};

router.patch("/settings/values/:key", settingsAccess, async (req, res) => {
  const schema = VALUE_SCHEMAS[req.params.key];
  if (!schema) throw new CrmError(404, "Unknown setting");
  let value = parse(schema, req.body);
  // Codes merge into what is stored: a code leads may carry is never removed, only set to "Not used"
  if (req.params.key === "codes") value = { ...(await getCodes()), ...value };
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO crm_settings (key, value, updated_by, updated_at) VALUES ($1, $2, $3, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
      [req.params.key, JSON.stringify(value), user(req).sub]
    );
    if (req.params.key === "codes") await reapplyCodeRoles(client, value);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  return res.json(value);
});

// ── Dev only: show a lead arriving live in the demo ─────────────────────────

const FIRST = ["Aarav", "Diya", "Kabir", "Meera", "Rohan", "Saanvi", "Vihaan", "Anaya", "Ishaan", "Tara"];
const LAST = ["Sharma", "Verma", "Iyer", "Nair", "Gill", "Kapoor", "Joshi", "Bose"];
// Checked per request: at import time .env may not be loaded yet
router.post("/dev/simulate-lead", leadsAccess, async (_req, res) => {
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
