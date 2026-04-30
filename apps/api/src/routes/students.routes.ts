import { Router } from "express";
import { z } from "zod";
import multer from "multer";
import { parse } from "csv-parse/sync";
import pool from "../db/pool";
import { requireAuth } from "../middleware/auth";
import { requireOwner } from "../middleware/requireOwner";

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

const patchSchema = z.object({
  name: z.string().min(1).max(150).optional(),
  phone: z.string().min(8).max(15).optional(),
  notes: z.string().max(1000).nullable().optional(),
});

router.use(requireAuth);
router.use(requireOwner);

router.get("/", async (_req, res) => {
  const result = await pool.query(
    "SELECT id, name, phone, notes, created_at FROM students ORDER BY created_at DESC"
  );
  return res.json(result.rows);
});

router.post("/import", upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "File is required" });
  }

  const csvText = req.file.buffer.toString("utf-8");
  let rows: Array<Record<string, string>> = [];

  try {
    rows = parse(csvText, { columns: true, skip_empty_lines: true, trim: true });
  } catch {
    return res.status(400).json({ error: "Invalid CSV" });
  }

  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      const name = String(row.name || "").trim();
      const rawPhone = String(row.phone || "").trim();
      const phone = rawPhone.replace(/\D/g, "");
      const notes = row.notes ? String(row.notes).trim() : null;

      if (!name || !phone) {
        errors.push(`Row ${i + 1}: missing name or phone`);
        skipped += 1;
        continue;
      }
      if (phone.length < 10 || phone.length > 13) {
        errors.push(`Row ${i + 1}: invalid phone length`);
        skipped += 1;
        continue;
      }

      const result = await client.query(
        "INSERT INTO students (name, phone, notes) VALUES ($1, $2, $3) " +
          "ON CONFLICT (phone) DO NOTHING",
        [name, phone, notes]
      );
      if (result.rowCount === 1) {
        imported += 1;
      } else {
        skipped += 1;
      }
    }
    await client.query("COMMIT");
  } catch {
    await client.query("ROLLBACK");
    return res.status(500).json({ error: "Import failed" });
  } finally {
    client.release();
  }

  return res.json({ imported, skipped, errors });
});

router.patch("/:id", async (req, res) => {
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
  if (updates.phone !== undefined) {
    values.push(updates.phone);
    fields.push(`phone = $${values.length}`);
  }
  if (updates.notes !== undefined) {
    values.push(updates.notes ?? null);
    fields.push(`notes = $${values.length}`);
  }

  if (fields.length === 0) {
    return res.status(400).json({ error: "No fields to update" });
  }

  values.push(req.params.id);

  try {
    const result = await pool.query(
      `UPDATE students SET ${fields.join(", ")} WHERE id = $${values.length} ` +
        "RETURNING id, name, phone, notes, created_at",
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Not found" });
    }

    return res.json(result.rows[0]);
  } catch (err: any) {
    if (err?.code === "23505") {
      return res.status(409).json({ error: "Phone already exists" });
    }
    return res.status(500).json({ error: "Update failed" });
  }
});

router.delete("/:id", async (req, res) => {
  const result = await pool.query("DELETE FROM students WHERE id = $1 RETURNING id", [req.params.id]);
  if (result.rows.length === 0) {
    return res.status(404).json({ error: "Not found" });
  }
  return res.json({ id: result.rows[0].id });
});

export default router;
