import { Router } from "express";
import { z } from "zod";
import pool from "../db/pool";
import { requireAuth } from "../middleware/auth";
import { requireOwner } from "../middleware/requireOwner";

const router = Router();

router.use(requireAuth);

router.get("/status", async (_req, res) => {
  const stateRes = await pool.query(
    "SELECT ftp_last_sync_at FROM system_state WHERE id = 1"
  );

  const row = stateRes.rows[0] || { ftp_last_sync_at: null };

  return res.json({
    ftp_last_sync_at: row.ftp_last_sync_at,
  });
});

// Recording compression format the FTP service uses for new uploads.
router.get("/settings", requireOwner, async (_req, res) => {
  const stateRes = await pool.query(
    "SELECT audio_format FROM system_state WHERE id = 1"
  );

  return res.json({
    audio_format: stateRes.rows[0]?.audio_format ?? "opus",
  });
});

const settingsSchema = z.object({
  audio_format: z.enum(["mp3", "opus"]),
});

router.patch("/settings", requireOwner, async (req, res) => {
  const parsed = settingsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid settings", details: parsed.error.flatten() });
  }

  const result = await pool.query(
    "UPDATE system_state SET audio_format = $1 WHERE id = 1 RETURNING audio_format",
    [parsed.data.audio_format]
  );

  return res.json({ audio_format: result.rows[0]?.audio_format ?? parsed.data.audio_format });
});

export default router;
