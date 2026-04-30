import { Router } from "express";
import { z } from "zod";
import pool from "../db/pool";
import { requireAuth } from "../middleware/auth";
import { requireOwner } from "../middleware/requireOwner";

const router = Router();

const patchSchema = z.object({
  employee_id: z.string().uuid().nullable().optional(),
  purpose: z.string().max(200).nullable().optional(),
});

router.use(requireAuth);

router.get("/", async (_req, res) => {
  const result = await pool.query(
    "SELECT l.id, l.line_number, l.employee_id, l.purpose, l.assigned_at, " +
      "e.name AS employee_name, e.color_index AS employee_color_index, " +
      "COALESCE(c.cnt, 0) AS call_count_today " +
    "FROM lines l " +
    "LEFT JOIN employees e ON e.id = l.employee_id " +
    "LEFT JOIN ( " +
      "SELECT line_number, COUNT(*) AS cnt " +
      "FROM calls " +
      "WHERE line_number IS NOT NULL " +
        "AND called_at >= CURRENT_DATE " +
        "AND called_at < CURRENT_DATE + INTERVAL '1 day' " +
      "GROUP BY line_number " +
    ") c ON c.line_number = l.line_number " +
    "ORDER BY l.line_number ASC"
  );

  return res.json(result.rows.map((r) => ({
    ...r,
    call_count_today: Number(r.call_count_today),
    employee_color_index: r.employee_color_index !== null ? Number(r.employee_color_index) : null,
  })));
});

router.patch("/:id", requireOwner, async (req, res) => {
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request" });
  }

  const updates = parsed.data;
  const fields: string[] = [];
  const values: Array<string | null> = [];

  if (updates.employee_id !== undefined) {
    values.push(updates.employee_id);
    const idx = values.length;
    fields.push(`employee_id = $${idx}`);
    fields.push(`assigned_at = CASE WHEN $${idx}::uuid IS NULL THEN NULL ELSE NOW() END`);
  }

  if (updates.purpose !== undefined) {
    values.push(updates.purpose ?? null);
    fields.push(`purpose = $${values.length}`);
  }

  if (fields.length === 0) {
    return res.status(400).json({ error: "No fields to update" });
  }

  values.push(req.params.id);

  const result = await pool.query(
    `UPDATE lines SET ${fields.join(", ")} WHERE id = $${values.length} ` +
      "RETURNING id, line_number, employee_id, purpose, assigned_at",
    values
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ error: "Not found" });
  }

  return res.json(result.rows[0]);
});

export default router;
