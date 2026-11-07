-- MIGRATION 011 (1/2) — CRM: leads, interactions, permissions, settings
-- Re-runnable: migrate.ts applies every file on every run and skips the REST of a
-- file after an "already exists" error, so every statement here is guarded.

CREATE SEQUENCE IF NOT EXISTS leads_code_seq START WITH 105900;

CREATE TABLE IF NOT EXISTS leads (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_code         VARCHAR(20) NOT NULL UNIQUE DEFAULT ('LMS-' || nextval('leads_code_seq')),
  name              VARCHAR(150) NOT NULL DEFAULT '',
  email             VARCHAR(200),
  phone_raw         VARCHAR(40) NOT NULL,
  phone10           VARCHAR(10) NOT NULL UNIQUE,     -- last 10 digits, the match key everywhere
  source            VARCHAR(60),
  campaign          VARCHAR(150),
  external_id       VARCHAR(150) UNIQUE,             -- sheet / Meta lead id; NULLs allowed
  status            VARCHAR(10) NOT NULL DEFAULT 'new'
                    CHECK (status IN ('new','retry','callback','converted','dnc','dropped')),
  current_code      CHAR(1) CHECK (current_code ~ '^[A-O]$'),
  next_followup_at  TIMESTAMPTZ,
  callback_set_by   UUID REFERENCES employees(id) ON DELETE SET NULL,
  attempts          INTEGER NOT NULL DEFAULT 0,      -- failed attempts (A/B/C) since last real contact
  last_contacted_at TIMESTAMPTZ,
  amount            NUMERIC(10,2),
  raw               JSONB,                           -- the intake row as received
  tags              TEXT[] NOT NULL DEFAULT '{}',
  locked_by         UUID REFERENCES employees(id) ON DELETE SET NULL,
  locked_until      TIMESTAMPTZ,
  version           INTEGER NOT NULL DEFAULT 1,      -- optimistic concurrency
  updated_by        UUID REFERENCES employees(id) ON DELETE SET NULL, -- named in a 409
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER SEQUENCE leads_code_seq OWNED BY leads.lead_code;
-- Rep who should make the next callback (pre-filled with whoever handled the lead last).
-- The pool still sees every lead; this only names the person.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES employees(id) ON DELETE SET NULL;
-- "Guitar" Yes/No on the lead form
ALTER TABLE leads ADD COLUMN IF NOT EXISTS has_guitar BOOLEAN;

CREATE INDEX IF NOT EXISTS idx_leads_status_followup ON leads (status, next_followup_at);
CREATE INDEX IF NOT EXISTS idx_leads_followup        ON leads (next_followup_at) WHERE next_followup_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_created         ON leads (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_campaign        ON leads (campaign);
CREATE INDEX IF NOT EXISTS idx_leads_code            ON leads (current_code);

CREATE TABLE IF NOT EXISTS lead_interactions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id          UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  employee_id      UUID REFERENCES employees(id) ON DELETE SET NULL,
  kind             VARCHAR(15) NOT NULL CHECK (kind IN ('call_outcome','system','reenquiry')),
  code             CHAR(1) CHECK (code ~ '^[A-O]$'),
  reason           VARCHAR(150),
  note             TEXT,
  next_followup_at TIMESTAMPTZ,
  call_id          UUID REFERENCES calls(id) ON DELETE SET NULL,
  meta             JSONB,                            -- intake source / status after the save / system detail
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_li_lead_created ON lead_interactions (lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_li_emp_created  ON lead_interactions (employee_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_li_unlinked     ON lead_interactions (lead_id, created_at) WHERE kind = 'call_outcome' AND call_id IS NULL;
-- Re-enquiries keep their own intake id, so ingest + reconcile stay idempotent
CREATE INDEX IF NOT EXISTS idx_li_reenquiry_ext ON lead_interactions ((meta ->> 'external_id')) WHERE kind = 'reenquiry';
-- A recording belongs to at most one form
CREATE UNIQUE INDEX IF NOT EXISTS uq_li_call   ON lead_interactions (call_id) WHERE call_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS employee_permissions (
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  permission  VARCHAR(30) NOT NULL CHECK (permission IN ('export_leads')),
  granted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (employee_id, permission)
);

CREATE TABLE IF NOT EXISTS crm_settings (
  key        VARCHAR(50) PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_by UUID REFERENCES employees(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Failures inside the calls → form matching trigger (it never blocks an insert)
CREATE TABLE IF NOT EXISTS crm_match_errors (
  id         BIGSERIAL PRIMARY KEY,
  call_id    UUID,
  error      TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Defaults (kept if the owner already changed them in CRM Settings) ──
-- codes: the sheet's status letters A–O; role = what saving that status does (see lib/crm/rules.ts)

INSERT INTO crm_settings (key, value) VALUES
  ('retry_rules', '{"invalid":{"never":true},"max_attempts":0}'),
  ('codes', '{"A":{"label":"Not reachable","role":"retry","hours":6},"B":{"label":"No response","role":"retry","hours":3},
    "C":{"label":"Call cut","role":"retry","next_day_at":"10:00"},"D":{"label":"Call later","role":"callback"},
    "E":{"label":"Will pay later","role":"callback"},"F":{"label":"Converted","role":"paid"},"G":{"label":"Not interested","role":"closed"},
    "H":{"label":"Code H","role":"unused"},"I":{"label":"Code I","role":"unused"},"J":{"label":"Code J","role":"unused"},
    "K":{"label":"Code K","role":"unused"},"L":{"label":"Code L","role":"unused"},"M":{"label":"Code M","role":"unused"},
    "N":{"label":"Code N","role":"unused"},"O":{"label":"Code O","role":"unused"}}')
ON CONFLICT (key) DO NOTHING;
