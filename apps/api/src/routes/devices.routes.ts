import { Router } from "express";
import { z } from "zod";
import pool from "../db/pool";
import { requireAuth } from "../middleware/auth";
import { requireOwner } from "../middleware/requireOwner";

const router = Router();

const createSchema = z.object({
  device_name: z.string().min(1).max(100),
  phone_number: z.string().min(8).max(15),
  employee_id: z.string().uuid().nullable().optional(),
  storage_path: z.string().max(500).nullable().optional(),
});

router.use(requireAuth);

router.get("/names", async (_req, res) => {
  const result = await pool.query(
    "SELECT id, device_name FROM devices ORDER BY created_at ASC"
  );
  return res.json(result.rows);
});

router.get("/", requireOwner, async (_req, res) => {
  const result = await pool.query(
    "SELECT id, device_name, phone_number, employee_id, storage_path, last_sync_at, created_at " +
      "FROM devices ORDER BY created_at ASC"
  );
  return res.json(result.rows);
});

router.post("/", requireOwner, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request" });
  }

  const { device_name, phone_number, employee_id, storage_path } = parsed.data;

  const result = await pool.query(
    "INSERT INTO devices (device_name, phone_number, employee_id, storage_path) " +
      "VALUES ($1, $2, $3, $4) " +
      "RETURNING id, device_name, phone_number, employee_id, storage_path, last_sync_at, created_at",
    [device_name, phone_number, employee_id ?? null, storage_path ?? null]
  );

  return res.status(201).json(result.rows[0]);
});

router.delete("/:id", requireOwner, async (req, res) => {
  const result = await pool.query("DELETE FROM devices WHERE id = $1 RETURNING id", [req.params.id]);
  if (result.rows.length === 0) {
    return res.status(404).json({ error: "Not found" });
  }
  return res.json({ id: result.rows[0].id });
});

export default router;
