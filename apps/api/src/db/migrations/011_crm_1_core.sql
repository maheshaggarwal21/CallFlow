-- MIGRATION 011 (1/3) — CRM: leads, interactions, owner-managed lists, permissions, settings
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
  current_code      CHAR(1) CHECK (current_code IN ('A','B','C','D','E','F','Z')),
  next_followup_at  TIMESTAMPTZ,
  callback_set_by   UUID REFERENCES employees(id) ON DELETE SET NULL,
  student_set_time  BOOLEAN NOT NULL DEFAULT FALSE,  -- "student asked for this time"
  attempts          INTEGER NOT NULL DEFAULT 0,      -- failed attempts (A/B/C) since last real contact
  last_contacted_at TIMESTAMPTZ,
  amount            NUMERIC(10,2),
  answers           JSONB NOT NULL DEFAULT '[]',     -- [{question_id, label, value}], label snapshot
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

CREATE INDEX IF NOT EXISTS idx_leads_status_followup ON leads (status, next_followup_at);
CREATE INDEX IF NOT EXISTS idx_leads_followup        ON leads (next_followup_at) WHERE next_followup_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_created         ON leads (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_campaign        ON leads (campaign);
CREATE INDEX IF NOT EXISTS idx_leads_code            ON leads (current_code);

CREATE TABLE IF NOT EXISTS wati_templates (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       VARCHAR(100) NOT NULL UNIQUE,           -- WATI template name
  label      VARCHAR(100) NOT NULL,
  body       TEXT NOT NULL,                          -- {name}, {amount}, {date}, {time}, {payment_link}, {class_link}
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lead_interactions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id          UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  employee_id      UUID REFERENCES employees(id) ON DELETE SET NULL,
  kind             VARCHAR(15) NOT NULL CHECK (kind IN ('call_outcome','whatsapp','system','reenquiry')),
  code             CHAR(1) CHECK (code IN ('A','B','C','D','E','F','Z')),
  reason           VARCHAR(150),
  note             TEXT,
  template_id      UUID REFERENCES wati_templates(id) ON DELETE SET NULL,
  answers          JSONB,
  next_followup_at TIMESTAMPTZ,
  call_id          UUID REFERENCES calls(id) ON DELETE SET NULL,
  meta             JSONB,                            -- whatsapp text / intake source / system detail
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_li_lead_created ON lead_interactions (lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_li_emp_created  ON lead_interactions (employee_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_li_unlinked     ON lead_interactions (lead_id, created_at) WHERE kind = 'call_outcome' AND call_id IS NULL;
-- Re-enquiries keep their own intake id, so ingest + reconcile stay idempotent
CREATE INDEX IF NOT EXISTS idx_li_reenquiry_ext ON lead_interactions ((meta ->> 'external_id')) WHERE kind = 'reenquiry';
-- A recording belongs to at most one form
CREATE UNIQUE INDEX IF NOT EXISTS uq_li_call   ON lead_interactions (call_id) WHERE call_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS lead_questions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label      VARCHAR(150) NOT NULL,
  type       VARCHAR(10) NOT NULL CHECK (type IN ('yesno','select','text')),
  options    JSONB NOT NULL DEFAULT '[]',
  sort_order INTEGER NOT NULL DEFAULT 0,
  active     BOOLEAN NOT NULL DEFAULT TRUE,          -- deactivated, never deleted
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS note_templates (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label      VARCHAR(100) NOT NULL,
  text       TEXT NOT NULL,                          -- may contain {date} / {time}
  codes      TEXT[] NOT NULL,
  category   VARCHAR(50),
  sort_order INTEGER NOT NULL DEFAULT 0,
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lead_reasons (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label      VARCHAR(100) NOT NULL,
  codes      TEXT[] NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS employee_permissions (
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  permission  VARCHAR(30) NOT NULL CHECK (permission IN
              ('manage_questions','manage_templates','reassign_leads','export_leads','view_crm_reports')),
  granted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (employee_id, permission)
);

CREATE TABLE IF NOT EXISTS crm_settings (
  key        VARCHAR(50) PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_by UUID REFERENCES employees(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One row per F-digest day; the PK is the send lock (same idea as report_runs)
CREATE TABLE IF NOT EXISTS crm_digest_runs (
  period_key VARCHAR(20) PRIMARY KEY,
  status     VARCHAR(10) NOT NULL CHECK (status IN ('sending','sent','failed')),
  attempts   INTEGER NOT NULL DEFAULT 1,
  error      TEXT,
  sent_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Failures inside the calls → form matching trigger (it never blocks an insert)
CREATE TABLE IF NOT EXISTS crm_match_errors (
  id         BIGSERIAL PRIMARY KEY,
  call_id    UUID,
  error      TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Product defaults (only when the list is empty, so owner edits survive re-runs) ──

INSERT INTO crm_settings (key, value) VALUES
  ('retry_rules', '{"A":{"hours":6},"B":{"hours":3},"C":{"next_day_at":"10:00"},"invalid":{"never":true},"max_attempts":6}'),
  ('digest',      '{"send_time":"21:00","recipients":[]}'),
  ('call_check',  '{"mode":"preview"}'),
  ('links',       '{"payment_link":"https://pay.example.com/max-trial","class_link":"https://meet.example.com/max-class"}')
ON CONFLICT (key) DO NOTHING;

INSERT INTO lead_questions (label, type, options, sort_order)
SELECT * FROM (VALUES
  ('Has a guitar?',        'yesno',  '[]'::jsonb, 1),
  ('Age group',            'select', '["Under 10","10–15","16–25","26–40","40+"]'::jsonb, 2),
  ('Prior experience',     'select', '["None","Beginner","Intermediate","Advanced"]'::jsonb, 3),
  ('Preferred class time', 'select', '["Morning (7–11)","Afternoon (12–4)","Evening (5–8)","Night (8–11)"]'::jsonb, 4)
) v WHERE NOT EXISTS (SELECT 1 FROM lead_questions);

INSERT INTO lead_reasons (label, codes, sort_order)
SELECT * FROM (VALUES
  ('Switched off',               ARRAY['A'], 1),
  ('Not reachable',              ARRAY['A'], 2),
  ('Invalid number',             ARRAY['A'], 3),
  ('Rang, no answer',            ARRAY['B'], 4),
  ('Busy / on another call',     ARRAY['B'], 5),
  ('Cut the call',               ARRAY['C'], 6),
  ('Cut after hearing price',    ARRAY['C'], 7),
  ('Busy right now',             ARRAY['D'], 8),
  ('Asked to call in the evening', ARRAY['D'], 9),
  ('Will discuss with parents',  ARRAY['D','E'], 10),
  ('Will pay after salary',      ARRAY['E'], 11),
  ('Buying a guitar first',      ARRAY['E'], 12),
  ('Paid on call (UPI)',         ARRAY['F'], 13),
  ('Paid via payment link',      ARRAY['F'], 14),
  ('Too expensive',              ARRAY['Z'], 15),
  ('Not interested any more',    ARRAY['Z'], 16),
  ('Joined somewhere else',      ARRAY['Z'], 17),
  ('Wants offline classes',      ARRAY['Z'], 18),
  ('Did not enquire / wrong number', ARRAY['Z'], 19)
) v WHERE NOT EXISTS (SELECT 1 FROM lead_reasons);

INSERT INTO note_templates (label, text, codes, category, sort_order)
SELECT * FROM (VALUES
  ('Call back at time',   'Asked to call back on {date} at {time}.',                       ARRAY['D'], 'callback', 1),
  ('Busy at work',        'Busy at work right now. Call on {date} after {time}.',          ARRAY['D'], 'callback', 2),
  ('Parents decide',      'Interested; checking with parents. Follow up {date} at {time}.', ARRAY['D','E'], 'callback', 3),
  ('Pays on date',        'Interested in the ₹299 trial, will pay on {date}. Call at {time}.', ARRAY['E'], 'payment', 4),
  ('Buying guitar',       'Buying a guitar first, then joins. Call {date} {time}.',        ARRAY['E'], 'payment', 5),
  ('Paid UPI',            'Paid ₹299 trial on UPI during the call. Schedule first class.',  ARRAY['F'], 'paid', 6),
  ('Paid link',           'Paid ₹299 trial through the payment link. Send class link.',     ARRAY['F'], 'paid', 7),
  ('Do not call',         'Not interested, asked us not to call again.',                    ARRAY['Z'], 'closed', 8)
) v WHERE NOT EXISTS (SELECT 1 FROM note_templates);

INSERT INTO wati_templates (name, label, body, sort_order)
SELECT * FROM (VALUES
  ('trial_details', 'Trial details', 'Hi {name}, thanks for your interest in Max Music School guitar classes! Your ₹299 trial includes live classes with a teacher. Pay here to book: {payment_link}', 1),
  ('fee_reminder',  'Fee reminder',  'Hi {name}, a gentle reminder about your ₹{amount} trial fee. You can pay here: {payment_link}', 2),
  ('class_link',    'Class link',    'Hi {name}, your class is on {date} at {time}. Join here: {class_link}', 3)
) v WHERE NOT EXISTS (SELECT 1 FROM wati_templates);
