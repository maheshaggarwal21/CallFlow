import { FtpSrv, FileSystem } from "ftp-srv";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { parseFile } from "music-metadata";
import { parseFilename } from "./filenameParser";
import pool from "./db/pool";
import { uploadAudioObject } from "./services/storage";
import { aiQueue } from "./services/aiQueue";

const FTP_ROOT = path.join(os.tmpdir(), "korecall_ftp");
if (!fs.existsSync(FTP_ROOT)) {
  fs.mkdirSync(FTP_ROOT, { recursive: true });
}

// ── helpers ──────────────

async function getDurationSeconds(filePath: string): Promise<number> {
  try {
    const meta = await parseFile(filePath, { duration: true });
    return Math.round(meta.format.duration || 0);
  } catch {
    return 0;
  }
}

async function findStudentName(phone: string): Promise<string | null> {
  const normalized = phone.replace(/\D/g, "");
  if (!normalized) return null;
  const result = await pool.query(
    "SELECT name FROM students WHERE phone = $1 LIMIT 1",
    [normalized]
  );
  return result.rows[0]?.name || null;
}

async function findEmployeeId(lineNumber: string): Promise<string | null> {
  const result = await pool.query(
    "SELECT employee_id FROM lines WHERE line_number = $1 LIMIT 1",
    [lineNumber]
  );
  return result.rows[0]?.employee_id || null;
}

async function hasCallBySourceKey(sourceKey: string): Promise<boolean> {
  const result = await pool.query(
    "SELECT id FROM calls WHERE source_file_key = $1 LIMIT 1",
    [sourceKey]
  );
  return result.rows.length > 0;
}

async function insertCall(data: {
  source_file_key: string;
  line_number: string;
  intercom_code: string | null;
  call_direction: "inbound" | "outbound";
  caller_phone: string;
  student_name: string | null;
  called_at: Date;
  duration_secs: number;
  employee_id: string | null;
  is_misc: boolean;
  misc_reason: string | null;
  audio_storage_key: string | null;
  ai_status: "pending" | "failed" | "done";
  resolution_status: "resolved" | "escalated" | "no_response" | null;
}) {
  const result = await pool.query(
    `INSERT INTO calls (
        source, source_file_key, device_id, line_number, intercom_code,
        call_direction, caller_phone, student_name, called_at, duration_secs,
        employee_id, is_misc, misc_reason, audio_storage_key, ai_status, resolution_status
      ) VALUES (
        'korecall', $1, NULL, $2, $3, $4, $5, $6,
        $7, $8, $9, $10, $11, $12, $13, $14
      )
      ON CONFLICT (source_file_key) DO NOTHING
      RETURNING id`,
    [
      data.source_file_key, data.line_number, data.intercom_code,
      data.call_direction, data.caller_phone, data.student_name,
      data.called_at.toISOString(), data.duration_secs, data.employee_id,
      data.is_misc, data.misc_reason, data.audio_storage_key, data.ai_status,
      data.resolution_status,
    ]
  );
  return result.rows[0]?.id as string | undefined;
}

// ── core processor ──────────

// Best-effort line/direction extraction when full parsing fails
function partialParse(fileName: string): { lineNumber: string; direction: "inbound" | "outbound" } {
  const lineMatch = fileName.match(/^(\d{2})--/);
  const dirMatch  = fileName.match(/--([AB])-/i);
  return {
    lineNumber: lineMatch?.[1] ?? "00",
    direction:  dirMatch?.[1]?.toUpperCase() === "A" ? "inbound" : "outbound",
  };
}

async function processUploadedFile(
  localFilePath: string,
  fileName: string,
  sourceKey: string
) {
  try {
    if (await hasCallBySourceKey(sourceKey)) {
      console.log(`⏭️  Already processed: ${sourceKey}`);
      fs.unlinkSync(localFilePath);
      return;
    }

    const parsed       = parseFilename(fileName);
    const durationSecs = await getDurationSeconds(localFilePath);
    const isMisc       = durationSecs < 10;

    // Upload audio to R2 regardless of whether the filename parsed
    const fileStream = fs.createReadStream(localFilePath);
    const r2Key      = `korecall/${sourceKey}`;
    const uploaded   = await uploadAudioObject(r2Key, fileStream, "audio/wav");
    const audioKey   = uploaded ? r2Key : null;

    let callId: string | undefined;

    if (parsed) {
      const studentName = await findStudentName(parsed.callerPhone);
      const employeeId  = await findEmployeeId(parsed.lineNumber);
      const miscReason  = isMisc ? "Short duration — possible disconnect" : null;
      const aiStatus    = isMisc ? "done" : audioKey ? "pending" : "failed";

      callId = await insertCall({
        source_file_key:   sourceKey,
        line_number:       parsed.lineNumber,
        intercom_code:     parsed.intercomCode,
        call_direction:    parsed.direction,
        caller_phone:      parsed.callerPhone,
        student_name:      studentName,
        called_at:         parsed.calledAt,
        duration_secs:     durationSecs,
        employee_id:       employeeId,
        is_misc:           isMisc,
        misc_reason:       miscReason,
        audio_storage_key: audioKey,
        ai_status:         aiStatus,
        resolution_status: isMisc ? "no_response" : null,
      });

      console.log(`✅ Processed: ${fileName} | ${parsed.direction} | ${parsed.callerPhone}`);
    } else {
      // Filename doesn't match any known pattern — store with what we can infer
      const { lineNumber, direction } = partialParse(fileName);
      const employeeId = await findEmployeeId(lineNumber);
      const aiStatus   = audioKey ? "pending" : "failed";

      callId = await insertCall({
        source_file_key:   sourceKey,
        line_number:       lineNumber,
        intercom_code:     null,
        call_direction:    direction,
        caller_phone:      "Unknown",
        student_name:      null,
        called_at:         new Date(),
        duration_secs:     durationSecs,
        employee_id:       employeeId,
        is_misc:           isMisc,
        misc_reason:       "Filename could not be fully parsed",
        audio_storage_key: audioKey,
        ai_status:         aiStatus,
        resolution_status: isMisc ? "no_response" : null,
      });

      console.warn(`⚠️  Stored with partial info: ${fileName}`);
    }

    if (callId && !isMisc && audioKey) {
      await pool.query(
        "INSERT INTO ai_jobs (call_id, status) VALUES ($1, 'queued')",
        [callId]
      );
      await aiQueue.add({ callId }, { jobId: `call-${callId}` });
      console.log(`🤖 AI job queued for call: ${callId}`);
    }

    // Stamp the FTP sync time so the dashboard shows "FTP sync active"
    await pool.query(
      "UPDATE system_state SET ftp_last_sync_at = NOW() WHERE id = 1"
    );

  } catch (err) {
    console.error(`❌ Failed to process ${fileName}:`, err);
  } finally {
    // ALWAYS clean up the downloaded file from the server disk so we don't run out of space!
    if (fs.existsSync(localFilePath)) {
      try {
        fs.unlinkSync(localFilePath);
      } catch (cleanErr) {
        console.error(`Could not delete temp file ${localFilePath}`, cleanErr);
      }
    }
  }
}

// ── FTP Server ───────────────────────────────────────────────

export function startFtpServer() {
  const port = parseInt(process.env.FTP_SERVER_PORT || "21", 10);
  const pasvUrl = process.env.VPS_PUBLIC_IP || "168.144.68.199";
  
  const ftpServer = new FtpSrv({
    url: `ftp://0.0.0.0:${port}`,
    pasv_url: pasvUrl,
    pasv_min: 1024,
    pasv_max: 1050,
    anonymous: false,
  });

  ftpServer.on("login", ({ username, password, connection }, resolve, reject) => {
    if (username === process.env.FTP_USER && password === process.env.FTP_PASSWORD) {
      
      // Listen to the STOR (upload complete) event for this connection
      connection.on('STOR', async (error: Error | null, fileName: string) => {
        if (error) {
          console.error("FTP STOR Error:", error);
          return;
        }
        
        const isWav = fileName.toLowerCase().endsWith(".wav");
        if (!isWav) return;

        const localFilePath = path.isAbsolute(fileName)
          ? fileName
          : path.join(FTP_ROOT, fileName);

        const relativeKey = path.relative(FTP_ROOT, localFilePath)
          .replace(/\\/g, "/");
        if (relativeKey.startsWith("..")) {
          console.warn(`⚠️  Skipping file outside FTP root: ${fileName}`);
          return;
        }

        const sourceKey = relativeKey.replace(/^\//, "");
        const baseName = path.basename(localFilePath);

        await processUploadedFile(localFilePath, baseName, sourceKey);
      });

      resolve({ root: FTP_ROOT });
    } else {
      reject(new Error("Invalid credentials"));
    }
  });

  ftpServer.listen().then(() => {
    console.log(`📡 FTP server listening on port ${port} and saving temp files to ${FTP_ROOT}`);
  });
}
