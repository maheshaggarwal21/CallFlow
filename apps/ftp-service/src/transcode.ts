import { spawn } from "child_process";

// KoreCall writes 8 kHz / 8-bit A-law WAV (64 kbps). Re-encoding to a 16 kbps
// speech codec cuts each file to ~25% with no meaningful loss for phone audio,
// which is what keeps a 90-day window inside the R2 free tier.
export type AudioFormat = "mp3" | "opus";

export const AUDIO_FORMATS: Record<
  AudioFormat,
  { ext: string; contentType: string; codecArgs: string[] }
> = {
  // Plays everywhere, including older iPhones / Safari.
  mp3: {
    ext: ".mp3",
    contentType: "audio/mpeg",
    codecArgs: ["-c:a", "libmp3lame", "-b:a", "16k"],
  },
  // WebM rather than Ogg: Safari has played WebM/Opus far longer than Ogg/Opus.
  opus: {
    ext: ".webm",
    contentType: "audio/webm",
    codecArgs: ["-c:a", "libopus", "-b:a", "16k", "-application", "voip"],
  },
};

const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const TIMEOUT_MS = 120_000;

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

export function transcode(input: string, output: string, format: AudioFormat): Promise<void> {
  return runFfmpeg([
    "-hide_banner", "-loglevel", "error", "-y",
    "-i", input,
    "-ac", "1",
    ...AUDIO_FORMATS[format].codecArgs,
    output,
  ]);
}

/** Logs once at startup whether compression is available on this host. */
export async function checkFfmpeg(): Promise<boolean> {
  try {
    await runFfmpeg(["-hide_banner", "-loglevel", "error", "-version"]);
    return true;
  } catch {
    return false;
  }
}
