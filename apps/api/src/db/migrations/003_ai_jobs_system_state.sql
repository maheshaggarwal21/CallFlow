-- MIGRATION 003 - AI Jobs + System State

CREATE TABLE ai_jobs (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id    UUID NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  status     VARCHAR(20) NOT NULL DEFAULT 'queued'
             CHECK (status IN ('queued','processing','done','failed')),
  error_msg  TEXT,
  started_at TIMESTAMPTZ,
  done_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE system_state (
  id                   INTEGER PRIMARY KEY DEFAULT 1,
  ftp_last_sync_at     TIMESTAMPTZ,
  android_last_sync_at TIMESTAMPTZ,
  CHECK (id = 1)
);

INSERT INTO system_state (id) VALUES (1);
