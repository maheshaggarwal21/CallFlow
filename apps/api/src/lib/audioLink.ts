import { createHmac, timingSafeEqual } from "crypto";
import type { PlayFormat } from "../services/transcode.service";

// Converted audio is served by the API, but an <audio> element can't attach the
// auth header and cross-subdomain cookies are unreliable (Safari). So, like the
// R2 presigned URLs, the link carries its own short-lived signature instead.
const LINK_TTL_SECS = 900;

function sign(callId: string, format: PlayFormat, exp: number): string {
  const secret = process.env.JWT_SECRET || "";
  return createHmac("sha256", secret).update(`audio:${callId}:${format}:${exp}`).digest("hex");
}

/** API path (relative to /api/v1) that streams the call in `format`. */
export function signedAudioPath(callId: string, format: PlayFormat): string {
  const exp = Math.floor(Date.now() / 1000) + LINK_TTL_SECS;
  return `/audio/${callId}/${format}?exp=${exp}&sig=${sign(callId, format, exp)}`;
}

export function verifyAudioLink(callId: string, format: PlayFormat, exp: string, sig: string): boolean {
  const expNum = Number(exp);
  if (!process.env.JWT_SECRET || !Number.isInteger(expNum) || expNum < Date.now() / 1000) return false;
  const expected = Buffer.from(sign(callId, format, expNum), "hex");
  const given = Buffer.from(sig, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}
