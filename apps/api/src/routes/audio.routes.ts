import { Router } from "express";
import pool from "../db/pool";
import { verifyAudioLink } from "../lib/audioLink";
import { getConvertedAudio, PLAY_FORMATS, PlayFormat } from "../services/transcode.service";

// No requireAuth: these URLs are signed by GET /calls/:id, which already did
// the auth and employee-ownership checks (see lib/audioLink.ts).
const router = Router();

router.get("/:id/:format", async (req, res) => {
  const { id, format } = req.params;
  if (format !== "mp3" && format !== "opus") {
    return res.status(404).json({ error: "Not found" });
  }
  const { exp, sig } = req.query;
  if (typeof exp !== "string" || typeof sig !== "string" || !verifyAudioLink(id, format, exp, sig)) {
    return res.status(403).json({ error: "Link expired or invalid" });
  }

  let file: string | null;
  try {
    const result = await pool.query("SELECT audio_storage_key FROM calls WHERE id = $1 LIMIT 1", [id]);
    const key = result.rows[0]?.audio_storage_key as string | undefined;
    if (!key) return res.status(404).json({ error: "Not found" });
    file = await getConvertedAudio(id, key, format as PlayFormat);
  } catch (err) {
    console.error(`Audio conversion request for ${id} failed:`, err);
    file = null;
  }
  if (!file) return res.status(502).json({ error: "Could not convert recording" });

  // sendFile handles Range requests, so seeking works in the player
  res.type(PLAY_FORMATS[format as PlayFormat].contentType);
  res.set("Cache-Control", "private, max-age=900");
  return res.sendFile(file);
});

export default router;
