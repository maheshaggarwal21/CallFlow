import fs from "fs";
import path from "path";
import os from "os";
import { execFile } from "child_process";
import { promisify } from "util";
import { OpenAI } from "openai";
import pool from "../db/pool";
import { downloadAudioToFile } from "./storage.service";
import {
  buildDiarizationPrompt,
  buildSummaryPrompt,
  Turn,
} from "../queue/prompts";

const execFileAsync = promisify(execFile);

/**
 * Convert any audio format to 16-kHz mono PCM WAV using ffmpeg.
 * KoreCall recordings are G.711 A-law 8kHz — Whisper requires standard PCM.
 * Returns the path to the converted file (caller must delete it).
 */
async function toPcmWav(inputPath: string): Promise<string> {
  const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
  const outPath = path.join(os.tmpdir(), `callflow-pcm-${Date.now()}.wav`);
  await execFileAsync(ffmpeg, [
    "-y",
    "-i", inputPath,
    "-ar", "16000",   // 16 kHz — Whisper's preferred sample rate
    "-ac", "1",       // mono
    "-c:a", "pcm_s16le",  // 16-bit PCM
    outPath,
  ]);
  return outPath;
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

type SummaryResult = {
  summary: string;
  sentiment: "positive" | "negative" | "neutral";
};

function parseJsonOrThrow<T>(raw: string, label: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`${label}: invalid JSON - ${raw.slice(0, 200)}`);
  }
}

async function diarize(transcriptRaw: string): Promise<Turn[]> {
  const prompt = buildDiarizationPrompt(transcriptRaw);
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.1,
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
  });

  const raw = response.choices[0]?.message?.content ?? "{}";
  const parsed = parseJsonOrThrow<Record<string, unknown>>(raw, "Diarization");

  const turnsRaw: unknown = Array.isArray(parsed)
    ? parsed
    : (parsed as Record<string, unknown>).turns;

  if (!Array.isArray(turnsRaw)) {
    throw new Error(`Diarization: expected turns array, got ${raw.slice(0, 200)}`);
  }

  return (turnsRaw as { speaker?: string; text?: string }[]).map((t) => ({
    speaker: t.speaker === "Caller" ? "Caller" : "Agent",
    text: String(t.text ?? ""),
  }));
}

async function summarise(turns: Turn[]): Promise<SummaryResult> {
  const prompt = buildSummaryPrompt(turns);
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0,
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
  });

  const raw = response.choices[0]?.message?.content ?? "{}";
  const parsed = parseJsonOrThrow<Record<string, unknown>>(raw, "Summary");

  const summary = String(parsed.summary ?? "").trim();
  const sentiment = parsed.sentiment;

  if (sentiment !== "positive" && sentiment !== "negative" && sentiment !== "neutral") {
    throw new Error(`Summary: unexpected sentiment value "${sentiment}"`);
  }

  return { summary, sentiment };
}

export async function processAiJob(callId: string) {
  await pool.query(
    "UPDATE ai_jobs SET status = 'processing', started_at = NOW(), error_msg = NULL WHERE call_id = $1",
    [callId]
  );

  const callRes = await pool.query(
    "SELECT id, audio_storage_key, ai_status FROM calls WHERE id = $1 LIMIT 1",
    [callId]
  );

  if (callRes.rows.length === 0) {
    await pool.query(
      "UPDATE ai_jobs SET status = 'failed', error_msg = 'Call not found', done_at = NOW() WHERE call_id = $1",
      [callId]
    );
    return;
  }

  const call = callRes.rows[0];
  const audioKey = call.audio_storage_key as string | null;

  if (!audioKey) {
    await pool.query(
      "UPDATE ai_jobs SET status = 'failed', error_msg = 'Missing audio', done_at = NOW() WHERE call_id = $1",
      [callId]
    );
    await pool.query(
      "UPDATE calls SET ai_status = 'failed' WHERE id = $1",
      [callId]
    );
    return;
  }

  const tmpPath = await downloadAudioToFile(audioKey);
  if (!tmpPath) {
    await pool.query(
      "UPDATE ai_jobs SET status = 'failed', error_msg = 'Download failed', done_at = NOW() WHERE call_id = $1",
      [callId]
    );
    await pool.query(
      "UPDATE calls SET ai_status = 'failed' WHERE id = $1",
      [callId]
    );
    return;
  }

  // Convert to PCM WAV — KoreCall files are G.711 A-law which Whisper rejects
  let whisperPath = tmpPath;
  let convertedPath: string | null = null;
  try {
    convertedPath = await toPcmWav(tmpPath);
    whisperPath = convertedPath;
  } catch {
    // ffmpeg not available or conversion failed — try raw file anyway
    whisperPath = tmpPath;
  }

  try {
    const transcriptRes = await openai.audio.transcriptions.create({
      file: fs.createReadStream(whisperPath),
      model: "whisper-1",
      language: "hi",
      response_format: "text",
    });

    const transcriptRaw = typeof transcriptRes === "string" ? transcriptRes : (transcriptRes as { text: string }).text;

    const transcriptJson = await diarize(transcriptRaw);
    const summaryObj = await summarise(transcriptJson);

    await pool.query(
      "UPDATE calls SET ai_status = 'done', transcript_raw = $1, transcript_json = $2, summary = $3, sentiment = $4, updated_at = NOW() WHERE id = $5",
      [
        transcriptRaw,
        JSON.stringify(transcriptJson),
        summaryObj.summary || null,
        summaryObj.sentiment || null,
        callId,
      ]
    );

    await pool.query(
      "UPDATE ai_jobs SET status = 'done', done_at = NOW() WHERE call_id = $1",
      [callId]
    );
  } catch (err: any) {
    await pool.query(
      "UPDATE ai_jobs SET status = 'failed', error_msg = $1, done_at = NOW() WHERE call_id = $2",
      [String(err?.message || "AI failure"), callId]
    );
    await pool.query(
      "UPDATE calls SET ai_status = 'failed' WHERE id = $1",
      [callId]
    );
  } finally {
    fs.unlink(tmpPath, () => undefined);
    if (convertedPath) fs.unlink(convertedPath, () => undefined);
  }
}
