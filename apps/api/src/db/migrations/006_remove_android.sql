-- MIGRATION 006 — Remove Android / mobile app remnants

-- Drop android_last_sync_at from system_state (android app is removed)
ALTER TABLE system_state DROP COLUMN IF EXISTS android_last_sync_at;
