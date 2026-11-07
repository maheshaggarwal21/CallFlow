import { getAudioPresignedUrl } from "./storage.service";
import { storedFormatOf } from "./transcode.service";
import { signedAudioPath } from "../lib/audioLink";

/**
 * Playback URLs for one stored recording: the stored format is the R2 presigned
 * URL (or /dev-audio locally); the other format is a signed on-demand
 * conversion path. Shared by GET /calls/:id and the CRM history.
 */
export async function audioUrlsFor(callId: string, audioKey: string | null) {
  const audioUrl = audioKey ? await getAudioPresignedUrl(audioKey) : null;
  const storedFormat = audioKey ? storedFormatOf(audioKey) : null;
  const audioUrls = audioKey && audioUrl
    ? {
        opus: storedFormat === "opus" ? audioUrl : signedAudioPath(callId, "opus"),
        mp3: storedFormat === "mp3" ? audioUrl : signedAudioPath(callId, "mp3"),
      }
    : null;
  return { audio_presigned_url: audioUrl, audio_format: storedFormat, audio_urls: audioUrls };
}
