-- MIGRATION 011 (3/3) — CRM: short-call auto-check (PENDING CLIENT DECISION)
-- Kept in its own table so it can be dropped without touching anything else.
-- The prototype only holds seeded preview labels; nothing calls Deepgram.

CREATE TABLE IF NOT EXISTS call_checks (
  call_id    UUID PRIMARY KEY REFERENCES calls(id) ON DELETE CASCADE,
  label      VARCHAR(25) NOT NULL CHECK (label IN
             ('no_answer','busy','switched_off','invalid_number','possible_conversation')),
  confidence REAL,
  source     VARCHAR(20) NOT NULL DEFAULT 'preview',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
