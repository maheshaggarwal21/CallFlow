import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { randomBytes, createHash } from "crypto";
import pool from "../db/pool";
import { requireAuth } from "../middleware/auth";
import { requireOwner } from "../middleware/requireOwner";

const router = Router();

const createSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email().max(100),
  phone: z.string().min(8).max(15).optional().nullable(),
  role: z.enum(["owner", "employee"]).optional(),
  password: z.string().min(8).max(72),
});

const patchSchema = z.object({
  name:     z.string().min(1).max(100).optional(),
  email:    z.string().email().max(100).optional(),
  phone:    z.string().min(8).max(15).optional().nullable(),
  status:   z.enum(["active", "inactive"]).optional(),
  password: z.string().min(8).max(72).optional(),
});

function sha256(input: string) {
  return createHash("sha256").update(input).digest("hex");
}

router.use(requireAuth);

router.get("/names", async (_req, res) => {
  const result = await pool.query(
    "SELECT id, name, color_index FROM employees WHERE status = 'active' ORDER BY name ASC"
  );
  return res.json(result.rows);
});

router.get("/", requireOwner, async (_req, res) => {
  const result = await pool.query(
    "SELECT e.id, e.name, e.email, e.phone, e.role, e.status, e.color_index, " +
      "COALESCE(s.total, 0) AS stats_total, " +
      "COALESCE(s.inbound, 0) AS stats_inbound, " +
      "COALESCE(s.outbound, 0) AS stats_outbound, " +
      "COALESCE(s.avg_dur, 0) AS stats_avg_duration_secs " +
    "FROM employees e " +
    "LEFT JOIN ( " +
      "SELECT employee_id, " +
        "COUNT(*) AS total, " +
        "COUNT(*) FILTER (WHERE call_direction='inbound') AS inbound, " +
        "COUNT(*) FILTER (WHERE call_direction='outbound') AS outbound, " +
        "ROUND(AVG(duration_secs)) AS avg_dur " +
      "FROM calls WHERE is_misc = FALSE GROUP BY employee_id " +
    ") s ON s.employee_id = e.id " +
    "ORDER BY e.created_at ASC"
  );

  const data = result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    role: row.role,
    status: row.status,
    color_index: row.color_index,
    call_stats: {
      total: Number(row.stats_total),
      inbound: Number(row.stats_inbound),
      outbound: Number(row.stats_outbound),
      avg_duration_secs: Number(row.stats_avg_duration_secs),
    },
  }));

  return res.json(data);
});

router.get("/:id", async (req, res) => {
  const id = req.params.id;
  if (!req.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (req.user.role !== "owner" && req.user.sub !== id) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const result = await pool.query(
    "SELECT id, name, email, phone, role, status, color_index FROM employees WHERE id = $1 LIMIT 1",
    [id]
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ error: "Not found" });
  }

  return res.json(result.rows[0]);
});

router.post("/", requireOwner, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request" });
  }

  const { name, email, phone, role, password } = parsed.data;

  const colorRes = await pool.query("SELECT COALESCE(MAX(color_index), -1) + 1 AS next_index FROM employees");
  const nextIndex = Number(colorRes.rows[0]?.next_index || 0);

  const passwordHash = await bcrypt.hash(password, 12);

  try {
    const result = await pool.query(
      "INSERT INTO employees (name, email, phone, role, password_hash, color_index) " +
        "VALUES ($1, $2, $3, $4, $5, $6) " +
        "RETURNING id, name, email, phone, role, status, color_index",
      [name, email, phone || null, role || "employee", passwordHash, nextIndex]
    );
    return res.status(201).json(result.rows[0]);
  } catch (err: any) {
    if (err?.code === "23505") {
      return res.status(409).json({ error: "Email already exists" });
    }
    return res.status(500).json({ error: "Failed to create employee" });
  }
});

router.patch("/:id", requireOwner, async (req, res) => {
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request" });
  }

  const updates = parsed.data;
  const fields: string[] = [];
  const values: Array<string | null> = [];

  if (updates.name !== undefined) {
    values.push(updates.name);
    fields.push(`name = $${values.length}`);
  }
  if (updates.email !== undefined) {
    values.push(updates.email);
    fields.push(`email = $${values.length}`);
  }
  if (updates.phone !== undefined) {
    values.push(updates.phone ?? null);
    fields.push(`phone = $${values.length}`);
  }
  if (updates.status !== undefined) {
    values.push(updates.status);
    fields.push(`status = $${values.length}`);
  }
  if (updates.password !== undefined) {
    const hash = await bcrypt.hash(updates.password, 12);
    values.push(hash);
    fields.push(`password_hash = $${values.length}`);
  }

  if (fields.length === 0) {
    return res.status(400).json({ error: "No fields to update" });
  }

  values.push(req.params.id);

  try {
    const result = await pool.query(
      `UPDATE employees SET ${fields.join(", ")} WHERE id = $${values.length} ` +
        "RETURNING id, name, email, phone, role, status, color_index",
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Not found" });
    }

    return res.json(result.rows[0]);
  } catch (err: any) {
    if (err?.code === "23505") {
      return res.status(409).json({ error: "Email already in use by another account" });
    }
    throw err;
  }
});

router.post("/:id/api-key", requireOwner, async (req, res) => {
  const id = req.params.id;

  const apiKey = randomBytes(24).toString("hex");
  const apiKeyHash = sha256(apiKey);

  const result = await pool.query(
    "UPDATE employees SET api_key_hash = $1 WHERE id = $2 RETURNING id",
    [apiKeyHash, id]
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ error: "Not found" });
  }

  return res.json({ api_key: apiKey });
});

// DELETE /employees/:id/device — owner resets an employee's linked device so they can log in on a new phone
router.delete("/:id/device", requireOwner, async (req, res) => {
  const id = req.params.id;

  const empCheck = await pool.query("SELECT id FROM employees WHERE id = $1 LIMIT 1", [id]);
  if (empCheck.rows.length === 0) {
    return res.status(404).json({ error: "Employee not found" });
  }

  await pool.query("DELETE FROM devices WHERE employee_id = $1", [id]);

  return res.json({ ok: true, message: "Device unlinked. Employee can now log in on a new phone." });
});

export default router;
