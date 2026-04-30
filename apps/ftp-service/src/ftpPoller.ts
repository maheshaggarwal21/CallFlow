import { Client, FileInfo } from "basic-ftp";
import { Writable } from "stream";
import { parseFilename } from "./filenameParser";
import pool from "./db/pool";
import { aiQueue } from "./services/aiQueue";
import { uploadAudioObject } from "./services/storage";
import { parseBuffer } from "music-metadata";

function isDirectory(item: FileInfo) {
  return item.type === 2;
}

async function downloadToBuffer(client: Client, remotePath: string): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const writable = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(Buffer.from(chunk));
      cb();
    },
  });

  await client.downloadTo(writable, remotePath);
  return Buffer.concat(chunks);
}

async function getDurationSeconds(buffer: Buffer): Promise<number> {
  try {
    const meta = await parseBuffer(buffer, undefined, { duration: true });
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
}) {
  const result = await pool.query(
    "INSERT INTO calls (source, source_file_key, device_id, line_number, intercom_code, call_direction, " +
      "caller_phone, student_name, called_at, duration_secs, employee_id, is_misc, misc_reason, " +
      "audio_storage_key, ai_status) " +
      "VALUES ('korecall', $1, NULL, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) " +
      "ON CONFLICT (source_file_key) DO NOTHING " +
      "RETURNING id",
    [
      data.source_file_key,
      data.line_number,
      data.intercom_code,
      data.call_direction,
      data.caller_phone,
      data.student_name,
      data.called_at.toISOString(),
      data.duration_secs,
      data.employee_id,
      data.is_misc,
      data.misc_reason,
      data.audio_storage_key,
      data.ai_status,
    ]
  );

  return result.rows[0]?.id as string | undefined;
}

export async function pollFtpOnce() {
  const host = process.env.FTP_HOST;
  const user = process.env.FTP_USER;
  const password = process.env.FTP_PASSWORD;
  const port = Number(process.env.FTP_PORT || 21);

  if (!host || !user || !password) {
    throw new Error("FTP credentials missing");
  }

  const client = new Client();
  try {
    await client.access({ host, user, password, port });

    const months = (await client.list()).filter(isDirectory);

    for (const month of months) {
      await client.cd(month.name);
      const days = (await client.list()).filter(isDirectory);

      for (const day of days) {
        await client.cd(day.name);
        const files = await client.list();

        for (const file of files) {
          if (file.type !== 1 || !file.name.toLowerCase().endsWith(".wav")) {
            continue;
          }

          const parsed = parseFilename(file.name);
          if (!parsed) continue;

          const sourceKey = `${month.name}/${day.name}/${file.name}`;
          if (await hasCallBySourceKey(sourceKey)) {
            continue;
          }

          const buffer = await downloadToBuffer(client, file.name);
          const durationSecs = await getDurationSeconds(buffer);
          const isMisc = durationSecs < 30;
          const miscReason = isMisc ? "Short duration — possible disconnect" : null;
          const studentName = await findStudentName(parsed.callerPhone);
          const employeeId = await findEmployeeId(parsed.lineNumber);

          const key = `korecall/${sourceKey}`;
          const uploaded = await uploadAudioObject(key, buffer, "audio/wav");
          const audioKey = uploaded ? key : null;

          const aiStatus = isMisc ? "done" : audioKey ? "pending" : "failed";

          const callId = await insertCall({
            source_file_key: sourceKey,
            line_number: parsed.lineNumber,
            intercom_code: parsed.intercomCode,
            call_direction: parsed.direction,
            caller_phone: parsed.callerPhone,
            student_name: studentName,
            called_at: parsed.calledAt,
            duration_secs: durationSecs,
            employee_id: employeeId,
            is_misc: isMisc,
            misc_reason: miscReason,
            audio_storage_key: audioKey,
            ai_status: aiStatus,
          });

          if (callId && !isMisc && audioKey) {
            await pool.query(
              "INSERT INTO ai_jobs (call_id, status) VALUES ($1, 'queued')",
              [callId]
            );
            await aiQueue.add({ callId });
          }
        }

        await client.cdup();
      }

      await client.cdup();
    }

    await pool.query(
      "UPDATE system_state SET ftp_last_sync_at = NOW() WHERE id = 1"
    );
  } finally {
    client.close();
  }
}
