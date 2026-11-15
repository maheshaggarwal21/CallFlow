-- MIGRATION 025 — daily salary from targets (client, 15 Nov 2026; docs/salary-commission/EMPLOYEE-PAYMENT-FLOW.md).
-- Re-runnable. Nothing changes for anyone until "Daily pay starts from" is set (pay_settings.daily_pay_from).

-- The three target tick-boxes ("counts for daily salary") and the joining date.
ALTER TABLE employees ADD COLUMN IF NOT EXISTS tick_call    BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS tick_trial   BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS tick_regular BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS join_date    DATE;
-- existing people: the day their account was created (IST), correctable on the Users form
UPDATE employees SET join_date = (created_at AT TIME ZONE 'Asia/Kolkata')::date WHERE join_date IS NULL;

-- Working days: the weekly pattern and the start month. One row per setting.
CREATE TABLE IF NOT EXISTS pay_settings (
  key        VARCHAR(40) PRIMARY KEY,
  value      JSONB       NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Mon–Sat by default (ISO weekday numbers, 1 = Monday … 7 = Sunday); daily pay Off until a start month is chosen
INSERT INTO pay_settings (key, value) VALUES ('weekdays', '[1,2,3,4,5,6]'::jsonb) ON CONFLICT (key) DO NOTHING;
INSERT INTO pay_settings (key, value) VALUES ('daily_pay_from', 'null'::jsonb) ON CONFLICT (key) DO NOTHING;

-- Holidays for everyone: not counted at all.
CREATE TABLE IF NOT EXISTS holidays (
  day        DATE PRIMARY KEY,
  name       VARCHAR(60) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Each day's targets and ticks, saved when the day closes (so a later change leaves past days alone).
-- A row also means "the rep was working here that day".
CREATE TABLE IF NOT EXISTS day_targets (
  employee_id      UUID    NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  day              DATE    NOT NULL,
  target_call_secs INTEGER NOT NULL,
  target_trial     INTEGER NOT NULL,
  target_regular   INTEGER NOT NULL,
  tick_call        BOOLEAN NOT NULL,
  tick_trial       BOOLEAN NOT NULL,
  tick_regular     BOOLEAN NOT NULL,
  closed_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (employee_id, day)
);

-- "Count as full", set by the Super Admin on a day (e.g. the PBX was down and calls were not recorded).
CREATE TABLE IF NOT EXISTS day_overrides (
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  day         DATE NOT NULL,
  set_by      UUID REFERENCES employees(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (employee_id, day)
);
