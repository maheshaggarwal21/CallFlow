
import { Router } from "express";
import { z } from "zod";
import jwt from "jsonwebtoken";
import { createHash, randomUUID } from "crypto";
import path from "path";
import multer from "multer";
import rateLimit from "express-rate-limit";
import pool from "../db/pool";
import { aiQueue } from "../queue/aiQueue";
import { findStudentName } from "../services/studentLookup.service";
import { uploadAudioObject } from "../services/storage.service";

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

const mobileLoginLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

const mobileUploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});

const loginSchema = z.object({
  api_key: z.string().min(10),
});

const deviceSchema = z.object({
  device_name: z.string().min(1).max(100),
  phone_number: z.string().min(8).max(15),
  storage_path: z.string().max(500),
});

const callSchema = z.object({
  device_id: z.string().uuid(),
  caller_phone: z.string().min(1),
  call_direction: z.enum(["inbound", "outbound"]),
  called_at: z.string().min(1),
  duration_secs: z.coerce.number().int().min(0),
  is_misc: z.coerce.boolean().optional(),
  misc_reason: z.string().max(200).optional(),
});

function sha256(input: string) {
  return createHash("sha256").update(input).digest("hex");
}

async function getEmployeeFromApiKey(apiKey: string) {
  const apiKeyHash = sha256(apiKey);
  const result = await pool.query(
    "SELECT id, name, color_index, role FROM employees WHERE api_key_hash = $1 LIMIT 1",
    [apiKeyHash]
  );
  return result.rows[0] || null;
}

router.post("/auth/login", mobileLoginLimiter, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request" });
  }

  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    return res.status(500).json({ error: "Server misconfigured" });
  }

  const employee = await getEmployeeFromApiKey(parsed.data.api_key);
  if (!employee) {
    return res.status(401).json({ error: "Invalid API key" });
  }

  const token = jwt.sign(
    {
      sub: employee.id,
      role: employee.role,
      name: employee.name,
      color_index: employee.color_index,
    },
    jwtSecret,
    { expiresIn: "365d" }
  );

  const deviceRes = await pool.query(
    "SELECT id FROM devices WHERE employee_id = $1 ORDER BY created_at DESC LIMIT 1",
    [employee.id]
  );

  const existingDeviceId = deviceRes.rows[0]?.id || null;

  // If this employee already has a registered device, block re-login from a new phone.
  // The owner must reset the device from the web dashboard before a new phone can be linked.
  if (existingDeviceId) {
    return res.json({
      token,
      employee: {
        id: employee.id,
        name: employee.name,
        color_index: employee.color_index,
      },
      device_id: existingDeviceId,
      device_locked: true,
    });
  }

  return res.json({
    token,
    employee: {
      id: employee.id,
      name: employee.name,
      color_index: employee.color_index,
    },
    device_id: null,
    device_locked: false,
  });
});

router.post("/device/setup", async (req, res) => {
  const apiKey = String(req.header("x-api-key") || "");
  if (!apiKey) {
    return res.status(401).json({ error: "Missing API key" });
  }

  const employee = await getEmployeeFromApiKey(apiKey);
  if (!employee) {
    return res.status(401).json({ error: "Invalid API key" });
  }

  const parsed = deviceSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request" });
  }

  const { device_name, phone_number, storage_path } = parsed.data;
  const result = await pool.query(
    "INSERT INTO devices (device_name, phone_number, employee_id, storage_path) " +
      "VALUES ($1, $2, $3, $4) RETURNING id",
    [device_name, phone_number, employee.id, storage_path]
  );

  return res.json({ device_id: result.rows[0].id });
});

router.post("/calls", mobileUploadLimiter, upload.single("audio"), async (req, res) => {
  const apiKey = String(req.header("x-api-key") || "");
  if (!apiKey) {
    return res.status(401).json({ error: "Missing API key" });
  }

  const employee = await getEmployeeFromApiKey(apiKey);
  if (!employee) {
    return res.status(401).json({ error: "Invalid API key" });
  }

  const parsed = callSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request" });
  }

  const data = parsed.data;
  const isMisc = Boolean(data.is_misc);
  const studentName = await findStudentName(data.caller_phone);

  const deviceRes = await pool.query(
    "SELECT id FROM devices WHERE id = $1 AND employee_id = $2 LIMIT 1",
    [data.device_id, employee.id]
  );
  if (deviceRes.rows.length === 0) {
    return res.status(404).json({ error: "Device not found" });
  }

  let audioKey: string | null = null;
  if (req.file && req.file.buffer) {
    const ext = path.extname(req.file.originalname || "") || ".wav";
    const key = `android/${data.device_id}/${Date.now()}-${randomUUID()}${ext}`;
    const ok = await uploadAudioObject(key, req.file.buffer, req.file.mimetype);
    if (ok) audioKey = key;
  }

  const aiStatus = isMisc ? "done" : audioKey ? "pending" : "failed";

  const insertRes = await pool.query(
    "INSERT INTO calls (source, device_id, line_number, intercom_code, call_direction, " +
      "caller_phone, student_name, called_at, duration_secs, employee_id, is_misc, misc_reason, " +
      "audio_storage_key, ai_status) " +
      "VALUES ('android_app', $1, NULL, NULL, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) " +
      "RETURNING id",
    [
      data.device_id,
      data.call_direction,
      data.caller_phone,
      studentName,
      data.called_at,
      data.duration_secs,
      employee.id,
      isMisc,
      data.misc_reason || null,
      audioKey,
      aiStatus,
    ]
  );

  if (!isMisc && audioKey) {
    await pool.query(
      "INSERT INTO ai_jobs (call_id, status) VALUES ($1, 'queued')",
      [insertRes.rows[0].id]
    );
    await aiQueue.add(
      { callId: insertRes.rows[0].id },
      { jobId: `call-${insertRes.rows[0].id}` }
    );
  }

  await pool.query("UPDATE system_state SET android_last_sync_at = NOW() WHERE id = 1");

  return res.status(201).json({ id: insertRes.rows[0].id });
});

router.get("/sync-status", async (req, res) => {
  const apiKey = String(req.header("x-api-key") || "");
  if (!apiKey) {
    return res.status(401).json({ error: "Missing API key" });
  }

  const employee = await getEmployeeFromApiKey(apiKey);
  if (!employee) {
    return res.status(401).json({ error: "Invalid API key" });
  }

  const stateRes = await pool.query(
    "SELECT android_last_sync_at FROM system_state WHERE id = 1"
  );
  const queueRes = await pool.query(
    "SELECT COUNT(*) AS pending FROM ai_jobs WHERE status IN ('queued','processing')"
  );

  return res.json({
    last_sync_at: stateRes.rows[0]?.android_last_sync_at || null,
    pending_ai_jobs: Number(queueRes.rows[0]?.pending || 0),
  });
});

export default router;
