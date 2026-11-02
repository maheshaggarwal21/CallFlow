-- MIGRATION 009 — Scheduled per-employee email reports (Reports tab)
-- A schedule mails one report per selected employee at `send_time` IST.
-- report_runs logs every send; its UNIQUE key is the lock that stops a pm2
-- restart or a double tick from mailing the same report twice.

CREATE TABLE IF NOT EXISTS report_schedules (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             VARCHAR(100) NOT NULL,
  employee_ids     UUID[] NOT NULL,
  frequency        VARCHAR(10) NOT NULL CHECK (frequency IN ('daily','weekly','monthly')),
  send_time        TIME NOT NULL,                                  -- IST wall clock
  weekday          SMALLINT CHECK (weekday BETWEEN 0 AND 6),       -- weekly only, 0 = Sunday
  recipients       TEXT[] NOT NULL,
  subject_template TEXT NOT NULL,
  body_template    TEXT NOT NULL,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS report_runs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id UUID NOT NULL REFERENCES report_schedules(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  period_key  VARCHAR(40) NOT NULL,          -- IST send date, or 'manual:<ms>' for Send now
  status      VARCHAR(10) NOT NULL CHECK (status IN ('sending','sent','failed')),
  attempts    INTEGER NOT NULL DEFAULT 1,
  stats       JSONB,                         -- the exact figures that were mailed
  error       TEXT,
  sent_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (schedule_id, employee_id, period_key)
);

CREATE INDEX IF NOT EXISTS idx_report_runs_created ON report_runs (created_at DESC);
