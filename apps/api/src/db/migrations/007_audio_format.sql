-- MIGRATION 007 — Owner-selectable recording compression format
-- The FTP service transcodes every incoming KoreCall WAV to this format before
-- uploading to R2 (both 16 kbps mono, ~25% of the WAV size). Only affects new
-- recordings; existing objects keep whatever format they were stored in.
-- Opus is the default: browsers that can't play it get an MP3 converted on
-- demand by GET /api/v1/audio/:id/mp3, so only one copy is ever stored.

ALTER TABLE system_state ADD COLUMN IF NOT EXISTS audio_format VARCHAR(10) NOT NULL DEFAULT 'opus';
ALTER TABLE system_state DROP CONSTRAINT IF EXISTS system_state_audio_format_check;
ALTER TABLE system_state ADD CONSTRAINT system_state_audio_format_check
  CHECK (audio_format IN ('mp3','opus'));
