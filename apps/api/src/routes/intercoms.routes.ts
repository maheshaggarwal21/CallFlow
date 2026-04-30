import { Router } from "express";
import { z } from "zod";
import pool from "../db/pool";
import { requireAuth } from "../middleware/auth";
import { requireOwner } from "../middleware/requireOwner";

const router = Router();

const patchSchema = z.object({
  phone_number: z.string().min(8).max(15).nullable(),
});

router.use(requireAuth);

router.get("/", async (_req, res) => {
  const result = await pool.query(
    "SELECT i.id, i.intercom_code, i.phone_number, i.assigned_at, " +
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

  return res.json(result.rows);
});

router.patch("/:id", requireOwner, async (req, res) => {
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request" });
  }

  const phone = parsed.data.phone_number;

  const result = await pool.query(
    "UPDATE intercoms SET phone_number = $1::varchar, " +
      "assigned_at = CASE WHEN $1::varchar IS NULL THEN NULL ELSE NOW() END " +
      "WHERE id = $2 RETURNING id, intercom_code, phone_number, assigned_at",
    [phone, req.params.id]
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ error: "Not found" });
  }

  return res.json(result.rows[0]);
});

export default router;
