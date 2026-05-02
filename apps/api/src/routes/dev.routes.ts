/**
 * DEV-ONLY routes — only mounted when NODE_ENV !== 'production'
 * Used for testing AI pipeline and audio playback without R2 or FTP.
 */
import { Router } from "express";
import { z } from "zod";
import { existsSync, copyFileSync, mkdirSync, readFileSync } from "fs";
import path from "path";
import pool from "../db/pool";
import { aiQueue } from "../queue/aiQueue";
import { DEV_UPLOADS_DIR, uploadAudioObject } from "../services/storage.service";

const router = Router();

const testCallSchema = z.object({
  // Absolute path to a .wav file on this machine
  audio_file_path: z.string().min(1),
  // Optional call metadata — defaults to something sensible
  caller_phone:   z.string().optional().default("9876543210"),
  call_direction: z.enum(["inbound", "outbound"]).optional().default("inbound"),
  duration_secs:  z.number().int().positive().optional().default(90),
  employee_email: z.string().email().optional(),
});

/**
 * POST /api/v1/dev/test-call
 *
 * Inserts a fake call into the DB pointing at a local audio file,
 * then queues an AI job so you can verify Whisper + GPT-4o-mini.
 *
 * Body (JSON):
 *   audio_file_path  — absolute path to a .wav file on this machine (required)
 *   caller_phone     — defaults to "9876543210"
 *   call_direction   — "inbound" | "outbound" (default: "inbound")
 *   duration_secs    — integer seconds (default: 90)
 *   employee_email   — email of the employee to assign this call to (optional)
 *
 * Returns: { call_id, audio_key, message }
 */
router.post("/test-call", async (req, res) => {
  const parsed = testCallSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
  }

  const { audio_file_path, caller_phone, call_direction, duration_secs, employee_email } = parsed.data;

  if (!existsSync(audio_file_path)) {
    return res.status(400).json({ error: `File not found: ${audio_file_path}` });
  }

  // Copy file into dev-uploads under a stable key name
  mkdirSync(DEV_UPLOADS_DIR, { recursive: true });
  const ext = path.extname(audio_file_path) || ".wav";
  const audioKey = `dev-test-${Date.now()}${ext}`;
  copyFileSync(audio_file_path, path.join(DEV_UPLOADS_DIR, audioKey));

  // If R2 is configured, upload there too — downloadAudioToFile will use R2 when configured
  const audioBuffer = readFileSync(audio_file_path);
  await uploadAudioObject(audioKey, audioBuffer, "audio/wav");

  // Resolve employee if provided
  let employeeId: string | null = null;
  if (employee_email) {
    const empRes = await pool.query(
      "SELECT id FROM employees WHERE email = $1 LIMIT 1",
      [employee_email]
    );
    employeeId = empRes.rows[0]?.id ?? null;
  }

  // Insert call row
  const insertRes = await pool.query(
    `INSERT INTO calls
       (source, source_file_key, call_direction, caller_phone, called_at,
        duration_secs, employee_id, is_misc, audio_storage_key, ai_status)
     VALUES ('korecall', $1, $2, $3, NOW(), $4, $5, FALSE, $6, 'pending')
     RETURNING id`,
    [
      `dev/${audioKey}`,
      call_direction,
      caller_phone,
      duration_secs,
      employeeId,
      audioKey,   // stored as just the filename — storage.service uses basename()
    ]
  );

  const callId = insertRes.rows[0].id as string;

  // Insert ai_jobs row and enqueue
  await pool.query(
    "INSERT INTO ai_jobs (call_id, status) VALUES ($1, 'queued')",
    [callId]
  );
  await aiQueue.add({ callId });

  return res.json({
    call_id: callId,
    audio_key: audioKey,
    message: "Call inserted and AI job queued. Start the worker with: npm run worker",
  });
});

/**
 * GET /api/v1/dev/status
 * Quick health-check for dev routes.
 */
router.get("/status", (_req, res) => {
  res.json({
    dev_mode: true,
    uploads_dir: DEV_UPLOADS_DIR,
    message: "Dev routes active. POST /api/v1/dev/test-call to queue a test AI job.",
  });
});

export default router;
