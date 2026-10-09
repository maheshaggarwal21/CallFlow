import type { AudioFormat, Call } from "@callflow/shared-types";
import { API_BASE } from "@/lib/api";

/** What the viewer picked in the call panel's ⋯ menu. */
export type PlayChoice = "auto" | AudioFormat;

const CHOICE_KEY = "callflow:play-format";

export const FORMAT_LABEL: Record<AudioFormat | "wav", string> = {
  opus: "Opus",
  mp3: "MP3",
  wav: "WAV",
};

let opusSupport: boolean | null = null;

export function canPlayOpus(): boolean {
  if (typeof document === "undefined") return true;
  if (opusSupport === null) {
    opusSupport = document.createElement("audio").canPlayType('audio/webm; codecs="opus"') !== "";
  }
  return opusSupport;
}

function resolveUrl(url: string): string {
  // Converted formats come back as API paths; R2 links are already absolute
  return url.startsWith("/") ? `${API_BASE}${url}` : url;
}

/**
 * The format a play actually uses. Auto = Opus, or MP3 when this browser can't
 * play Opus. Legacy WAV recordings play as-is under Auto: they're already
 * playable everywhere and converting them would only lose quality.
 */
export function effectiveFormat(call: Call, choice: PlayChoice): AudioFormat | "wav" {
  const opusOk = canPlayOpus();
  if (choice === "opus" && opusOk) return "opus";
  if (choice !== "auto") return "mp3";
  if (call.audio_format === "wav") return "wav";
  return opusOk ? "opus" : "mp3";
}

export function audioUrlFor(call: Call, format: AudioFormat | "wav"): string | null {
  if (format === "wav" || !call.audio_urls) return call.audio_presigned_url ?? null;
  return resolveUrl(call.audio_urls[format]);
}

/** URLs to try in order for an inline (table/dashboard) play: Auto, then MP3. */
export function playbackCandidates(call: Call): string[] {
  const urls = [audioUrlFor(call, effectiveFormat(call, "auto")), audioUrlFor(call, "mp3")];
  return urls.filter((u, i): u is string => !!u && urls.indexOf(u) === i);
}

/**
 * Plays the first candidate, moving to the next if the browser rejects it.
 * Returns the element so the caller can pause it.
 */
export function playWithFallback(
  urls: string[],
  onDone: () => void
): HTMLAudioElement | null {
  if (urls.length === 0) return null;
  const audio = new Audio(urls[0]);
  let i = 0;
  audio.onended = onDone;
  audio.onerror = () => {
    i += 1;
    if (i >= urls.length) return onDone();
    audio.src = urls[i];
    audio.play().catch(() => {});
  };
  audio.play().catch(() => {});
  return audio;
}

export function loadPlayChoice(): PlayChoice {
  try {
    const v = localStorage.getItem(CHOICE_KEY);
    return v === "opus" || v === "mp3" ? v : "auto";
  } catch {
    return "auto";
  }
}

export function savePlayChoice(choice: PlayChoice) {
  try {
    localStorage.setItem(CHOICE_KEY, choice);
  } catch {
    // Private mode / blocked storage — the choice just won't persist
  }
}
