import { Router } from "express";
import { z } from "zod";
import pool from "../db/pool";
import { requireAuth } from "../middleware/auth";
import { requirePermission } from "../middleware/requirePermission";

const router = Router();

const patchSchema = z.object({
  phone_number: z.string().min(8).max(15).nullable(),
  // the line this intercom sits on; the Users form reads it to fill line / intercom / number together
  line_number: z.string().min(1).max(5).nullable().optional(),
});

router.use(requireAuth);

router.get("/", async (_req, res) => {
  const result = await pool.query(
    "SELECT i.id, i.intercom_code, i.phone_number, i.line_number, i.assigned_at, " +
      "COALESCE(c.cnt, 0) AS call_count_total " +
    "FROM intercoms i " +
    "LEFT JOIN ( " +
      "SELECT intercom_code, COUNT(*) AS cnt " +
      "FROM calls " +
      "WHERE intercom_code IS NOT NULL " +
      "GROUP BY intercom_code " +
    ") c ON c.intercom_code = i.intercom_code " +
    "ORDER BY i.intercom_code ASC"
  );

  return res.json(result.rows.map((r) => ({
    ...r,
    call_count_total: Number(r.call_count_total),
  })));
});

router.patch("/:id", requirePermission("intercoms"), async (req, res) => {
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request" });
  }

  const phone = parsed.data.phone_number;
  const line = parsed.data.line_number;

  let result;
  try {
    result = await pool.query(
      "UPDATE intercoms SET phone_number = $1::varchar, " +
        "assigned_at = CASE WHEN $1::varchar IS NULL THEN NULL ELSE NOW() END, " +
        "line_number = CASE WHEN $3::boolean THEN $4::varchar ELSE line_number END " +
        "WHERE id = $2 RETURNING id, intercom_code, phone_number, line_number, assigned_at",
      [phone, req.params.id, line !== undefined, line ?? null]
    );
  } catch (err: any) {
    if (err?.code === "23505") return res.status(409).json({ error: "That line already has an intercom", message: "That line already has an intercom" });
    throw err;
  }

  if (result.rows.length === 0) {
    return res.status(404).json({ error: "Not found" });
  }

  return res.json(result.rows[0]);
});

export default router;
