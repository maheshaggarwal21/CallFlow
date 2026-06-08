import { Router } from "express";
import { z } from "zod";
import pool from "../db/pool";
import { requireAuth } from "../middleware/auth";
import { getAudioPresignedUrl } from "../services/storage.service";

const router = Router();

const searchSchema = z.object({
  phone: z.string().min(3),
  limit: z.number().int().positive().max(200).optional(),
  offset: z.number().int().min(0).optional(),
});

const resolutionSchema = z.object({
  resolution_status: z.enum(["resolved", "escalated"]).nullable(),
});

router.use(requireAuth);

function parseLimit(value: any): number {
  const n = Number(value);
  if (Number.isNaN(n) || n <= 0) return 50;
  return Math.min(n, 200);
}

function parseOffset(value: any): number {
  const n = Number(value);
  if (Number.isNaN(n) || n < 0) return 0;
  return n;
}

function buildFilters(req: any) {
  const filters: string[] = [];
  const values: any[] = [];

  const add = (sql: string, value: any) => {
    values.push(value);
    filters.push(`${sql} $${values.length}`);
  };

  const q = req.query;

  if (q.date_from) add("c.called_at >=", q.date_from);
  if (q.date_to) add("c.called_at <=", q.date_to);
  if (q.line) add("c.line_number =", q.line);
  if (q.direction) add("c.call_direction =", q.direction);
  if (q.intercom) add("c.intercom_code =", q.intercom);

  if (q.is_misc === "true" || q.is_misc === "false") {
    add("c.is_misc =", q.is_misc === "true");
  }

  const phoneRaw = typeof q.phone === "string" ? q.phone : "";
  const phone = phoneRaw.replace(/\D/g, "");
  if (phone) {
    values.push(`%${phone}%`);
    filters.push(`regexp_replace(c.caller_phone, '\\D', '', 'g') LIKE $${values.length}`);
  }

  return { filters, values };
}

// Common SELECT columns (no AI columns — dropped by migration 005)
const CALL_COLS =
  "c.id, c.source, c.device_id, c.line_number, c.intercom_code, " +
  "c.call_direction, c.caller_phone, c.student_name, c.called_at, c.duration_secs, " +
  "c.employee_id, c.is_misc, c.misc_reason, c.resolution_status, c.created_at, c.updated_at, " +
  "i.phone_number AS intercom_phone_number, " +
  "'KoreCall' AS source_label, " +
  "e.color_index AS color_index, e.name AS employee_name";

const CALL_JOINS =
  "LEFT JOIN intercoms i ON i.intercom_code = c.intercom_code " +
  "LEFT JOIN employees e ON e.id = c.employee_id";

router.get("/", async (req, res) => {
  const { filters, values } = buildFilters(req);

  if (req.user?.role === "employee") {
    values.push(req.user.sub);
    filters.push(`c.employee_id = $${values.length}`);
  } else if (req.query.employee_id) {
    values.push(req.query.employee_id);
    filters.push(`c.employee_id = $${values.length}`);
  }

  const whereClause = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const limit = parseLimit(req.query.limit);
  const offset = parseOffset(req.query.offset);

  const countRes = await pool.query(
    `SELECT COUNT(*) AS total FROM calls c ${whereClause}`,
    values
  );

  const listRes = await pool.query(
    `SELECT ${CALL_COLS} FROM calls c ${CALL_JOINS} ${whereClause} ` +
    `ORDER BY c.called_at DESC LIMIT ${limit} OFFSET ${offset}`,
    values
  );

  return res.json({
    data: listRes.rows,
    total: Number(countRes.rows[0]?.total || 0),
    limit,
    offset,
  });
});

router.get("/:id", async (req, res) => {
  const id = req.params.id;

  const result = await pool.query(
    `SELECT ${CALL_COLS}, c.audio_storage_key ` +
    `FROM calls c ${CALL_JOINS} ` +
    "WHERE c.id = $1 LIMIT 1",
    [id]
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ error: "Not found" });
  }

  const row = result.rows[0];

  if (req.user?.role === "employee" && row.employee_id !== req.user.sub) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const audioKey = row.audio_storage_key as string | null;
  const audioUrl = audioKey ? await getAudioPresignedUrl(audioKey) : null;

  delete row.audio_storage_key;

  return res.json({
    ...row,
    audio_presigned_url: audioUrl,
  });
});

router.post("/search", async (req, res) => {
  const parsed = searchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request" });
  }

  const limit = parsed.data.limit ?? 50;
  const offset = parsed.data.offset ?? 0;
  const normalized = parsed.data.phone.replace(/\D/g, "").slice(-10);

  if (!normalized) {
    return res.status(400).json({ error: "Invalid phone" });
  }

  const filters: string[] = [];
  const values: any[] = [];

  values.push(`%${normalized}%`);
  filters.push(`regexp_replace(c.caller_phone, '\\D', '', 'g') LIKE $${values.length}`);

  if (req.user?.role === "employee") {
    values.push(req.user.sub);
    filters.push(`c.employee_id = $${values.length}`);
  }

  const whereClause = `WHERE ${filters.join(" AND ")}`;

  const countRes = await pool.query(
    `SELECT COUNT(*) AS total FROM calls c ${whereClause}`,
    values
  );

  const listRes = await pool.query(
    `SELECT ${CALL_COLS} FROM calls c ${CALL_JOINS} ${whereClause} ` +
    `ORDER BY c.called_at DESC LIMIT ${limit} OFFSET ${offset}`,
    values
  );

  return res.json({
    calls: listRes.rows,
    total: Number(countRes.rows[0]?.total || 0),
    found: listRes.rows.length > 0,
  });
});

router.patch("/:id/resolution", async (req, res) => {
  const parsed = resolutionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request" });
  }

  const callRes = await pool.query(
    "SELECT id, employee_id FROM calls WHERE id = $1 LIMIT 1",
    [req.params.id]
  );

  if (callRes.rows.length === 0) {
    return res.status(404).json({ error: "Not found" });
  }

  const call = callRes.rows[0];

  if (req.user?.role === "employee" && call.employee_id !== req.user.sub) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const result = await pool.query(
    "UPDATE calls SET resolution_status = $1 WHERE id = $2 RETURNING id, resolution_status",
    [parsed.data.resolution_status, req.params.id]
  );

  return res.json(result.rows[0]);
});

export default router;
