import { spawn } from "child_process";
import { existsSync, mkdirSync, readdirSync, renameSync, statSync, unlinkSync } from "fs";
import path from "path";
import os from "os";
import { downloadAudioToFile } from "./storage.service";

// Only one format is stored per recording (to stay inside the R2 free tier).
// When a browser can't play it, or someone picks the other format in the call
// panel, the API converts on demand and keeps the result on local disk for a
// few hours so repeat plays and seeks don't re-run ffmpeg.
export type PlayFormat = "mp3" | "opus";
export type StoredFormat = PlayFormat | "wav";

export const PLAY_FORMATS: Record<
  PlayFormat,
  { ext: string; muxer: string; contentType: string; codecArgs: string[] }
> = {
  mp3: {
    ext: ".mp3",
    muxer: "mp3",
    contentType: "audio/mpeg",
    codecArgs: ["-c:a", "libmp3lame", "-b:a", "16k"],
  },
  opus: {
    ext: ".webm",
    muxer: "webm",
    contentType: "audio/webm",
    codecArgs: ["-c:a", "libopus", "-b:a", "16k", "-application", "voip"],
  },
};

export function storedFormatOf(key: string): StoredFormat {
  const ext = path.extname(key).toLowerCase();
  if (ext === ".webm" || ext === ".ogg" || ext === ".opus") return "opus";
  if (ext === ".mp3") return "mp3";
  return "wav";
}

const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const TIMEOUT_MS = 60_000;
const CACHE_DIR = path.join(os.tmpdir(), "callflow-audio-cache");
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (chunk) => { stderr += chunk; });

    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error(`ffmpeg timed out after ${TIMEOUT_MS / 1000}s`));
    }, TIMEOUT_MS);

    proc.on("error", (err) => { clearTimeout(timer); reject(err); });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with ${code}: ${stderr.trim().slice(-500)}`));
    });
  });
}

function pruneCache() {
  const cutoff = Date.now() - CACHE_TTL_MS;
  for (const name of readdirSync(CACHE_DIR)) {
    const p = path.join(CACHE_DIR, name);
    try {
      if (statSync(p).mtimeMs < cutoff) unlinkSync(p);
    } catch {
      // Already gone or in use — next prune will get it
    }
  }
}

// Concurrent requests for the same call/format share one ffmpeg run
const inflight = new Map<string, Promise<string | null>>();

/**
 * Returns a local file holding the call's recording in `format`, converting it
 * from the stored object if needed. Null if the source can't be fetched or
 * ffmpeg fails.
 */
export function getConvertedAudio(
  callId: string,
  storageKey: string,
  format: PlayFormat
): Promise<string | null> {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });

  const out = path.join(CACHE_DIR, `${callId}${PLAY_FORMATS[format].ext}`);
  if (existsSync(out)) return Promise.resolve(out);

  const pending = inflight.get(out);
  if (pending) return pending;

  const job = (async () => {
    pruneCache();
    const src = await downloadAudioToFile(storageKey);
    if (!src) return null;
    const tmp = `${out}.${process.pid}.part`;
    try {
      await runFfmpeg([
        "-hide_banner", "-loglevel", "error", "-y",
        "-i", src,
        "-ac", "1",
        ...PLAY_FORMATS[format].codecArgs,
        "-f", PLAY_FORMATS[format].muxer,
        tmp,
      ]);
      renameSync(tmp, out);
      return out;
    } catch (err) {
      console.warn(`⚠️  Converting call ${callId} to ${format} failed: ${(err as Error).message}`);
      return null;
    } finally {
      for (const p of [src, tmp]) {
        if (existsSync(p)) {
          try { unlinkSync(p); } catch { /* ignore */ }
        }
      }
    }
  })().finally(() => inflight.delete(out));

  inflight.set(out, job);
  return job;
}
