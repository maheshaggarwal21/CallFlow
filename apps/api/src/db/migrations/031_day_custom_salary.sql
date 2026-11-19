-- MIGRATION 031 — a custom salary for one day (client, 19 Nov 2026), set by the Super Admin in the Days view beside
-- "Count as full". On a day_overrides row: amount_paise NULL = count as full; a value = that day pays exactly this.
-- Re-runnable.
ALTER TABLE day_overrides ADD COLUMN IF NOT EXISTS amount_paise INTEGER;
ALTER TABLE day_overrides DROP CONSTRAINT IF EXISTS day_overrides_amount_check;
ALTER TABLE day_overrides ADD CONSTRAINT day_overrides_amount_check CHECK (amount_paise IS NULL OR amount_paise >= 0);
