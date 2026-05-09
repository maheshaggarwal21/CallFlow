import fs from "fs";
import path from "path";
import os from "os";
import { execFile } from "child_process";
import { promisify } from "util";
import { OpenAI } from "openai";
import { DeepgramClient } from "@deepgram/sdk";
import type { ListenV1Response } from "@deepgram/sdk/dist/cjs/api/types/ListenV1Response.js";
import pool from "../db/pool";
import { downloadAudioToFile } from "./storage.service";
import {
  buildDiarizationPrompt,
  buildConsistencyCheckPrompt,
  buildSummaryPrompt,
  Turn,
  isUnansweredCall,
  isDialToneOnly,
} from "../queue/prompts";

const execFileAsync = promisify(execFile);

/**
 * Convert any audio format to 16-kHz mono PCM WAV using ffmpeg.
 * KoreCall recordings are G.711 A-law 8kHz — Whisper requires standard PCM.
 *
 * Audio normalization applied:
 *   dynaudnorm  — dynamic per-frame loudness normalization, boosts quiet caller
 *                 voice without clipping the louder agent voice on the same channel
 *   loudnorm    — final ITU-R BS.1770 pass to bring overall level to -16 LUFS
 *
 * Returns { path, durationSecs } — caller must delete the temp file.
 */
async function toPcmWav(inputPath: string): Promise<{ path: string; durationSecs: number }> {
  const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
  const ffprobe = process.env.FFPROBE_PATH || "ffprobe";
  const outPath = path.join(os.tmpdir(), `callflow-pcm-${Date.now()}.wav`);

  await execFileAsync(ffmpeg, [
    "-y",
    "-i", inputPath,
    "-ar", "16000",        // 16 kHz — Whisper's preferred sample rate
    "-ac", "1",            // mono
    "-c:a", "pcm_s16le",   // 16-bit PCM
    // Two-pass normalization:
    //  1. dynaudnorm: per-frame dynamic gain — lifts the quiet caller voice
    //  2. loudnorm: broadcast-standard final loudness target
    "-af", "dynaudnorm=f=150:g=15,loudnorm=I=-16:TP=-1.5:LRA=11",
    outPath,
  ]);

  // Extract actual duration from the converted file
  let durationSecs = 0;
  try {
    const { stdout } = await execFileAsync(ffprobe, [
      "-v", "quiet", "-print_format", "json", "-show_format", outPath,
    ]);
    const fmt = JSON.parse(stdout).format;
    durationSecs = Math.round(parseFloat(fmt?.duration ?? "0"));
  } catch {
    // ffprobe failed — leave duration as 0 (will not overwrite existing DB value)
  }

  return { path: outPath, durationSecs };
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const deepgram = new DeepgramClient({ apiKey: process.env.DEEPGRAM_API_KEY! });

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

// Deepgram Nova-3 for transcription only — better Hinglish accuracy than Whisper.
// Mono phone recordings mix both voices on one channel, so acoustic diarization
// cannot separate speakers reliably. Content-based GPT diarization follows separately.
async function transcribeWithDeepgram(audioPath: string): Promise<string> {
  const result = (await deepgram.listen.v1.media.transcribeFile(
    fs.createReadStream(audioPath),
    {
      model: "nova-3",
      punctuate: true,
      smart_format: true,
      language: "hi", // Hindi primary — Nova-3 handles Hinglish code-switching natively
    }
  )) as ListenV1Response;

  return result.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "";
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

type Correction = { index: number; newSpeaker: string; reason?: string };

async function consistencyCheck(turns: Turn[]): Promise<Turn[]> {
  if (turns.length < 3) return turns;

  const prompt = buildConsistencyCheckPrompt(turns);
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0,
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
  });

  const raw = response.choices[0]?.message?.content ?? "{}";
  const parsed = parseJsonOrThrow<{ corrections?: Correction[] }>(raw, "ConsistencyCheck");

  if (!Array.isArray(parsed.corrections) || parsed.corrections.length === 0) return turns;

  const corrected = turns.map((t) => ({ ...t }));
  for (const c of parsed.corrections) {
    if (
      typeof c.index === "number" &&
      c.index >= 0 &&
      c.index < corrected.length &&
      (c.newSpeaker === "Agent" || c.newSpeaker === "Caller")
    ) {
      corrected[c.index].speaker = c.newSpeaker as "Agent" | "Caller";
    }
  }
  return corrected;
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
  let actualDurationSecs = 0;
  try {
    const converted = await toPcmWav(tmpPath);
    convertedPath = converted.path;
    whisperPath = converted.path;
    actualDurationSecs = converted.durationSecs;
  } catch {
    // ffmpeg not available or conversion failed — try raw file anyway
    whisperPath = tmpPath;
  }

  // Persist actual duration now so it's correct even if AI steps fail
  if (actualDurationSecs > 0) {
    await pool.query(
      "UPDATE calls SET duration_secs = $1 WHERE id = $2",
      [actualDurationSecs, callId]
    );
  }

  try {
    const transcriptRaw = await transcribeWithDeepgram(whisperPath);

    let transcriptJson: Turn[];
    let summaryObj: { summary: string; sentiment: "positive" | "negative" | "neutral" };

    if (isDialToneOnly(transcriptRaw)) {
      transcriptJson = [{ speaker: "Agent", text: "[System] Dial tones only — no speech detected." }];
      summaryObj = { summary: "Call was placed but only dial tones were recorded. No conversation took place.", sentiment: "neutral" };
    } else if (isUnansweredCall(transcriptRaw)) {
      transcriptJson = [
        { speaker: "Agent", text: "[Automated] Call not answered — operator message detected." },
        { speaker: "Caller", text: "[System] Contact did not pick up." },
      ];
      summaryObj = { summary: "Call was not answered. An automated operator message played indicating the contact was unavailable or switched off.", sentiment: "neutral" };
    } else {
      const rawTurns = await diarize(transcriptRaw);
      transcriptJson = await consistencyCheck(rawTurns);
      summaryObj = await summarise(transcriptJson);
    }

    const autoResolution =
      summaryObj.sentiment === "positive" ? "resolved" :
      summaryObj.sentiment === "negative" ? "escalated" : null;

    await pool.query(
      "UPDATE calls SET ai_status = 'done', transcript_raw = $1, transcript_json = $2, summary = $3, sentiment = $4, resolution_status = $5, updated_at = NOW() WHERE id = $6",
      [
        transcriptRaw,
        JSON.stringify(transcriptJson),
        summaryObj.summary || null,
        summaryObj.sentiment || null,
        autoResolution,
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
