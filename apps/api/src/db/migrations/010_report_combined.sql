-- MIGRATION 010 — Option to mail all selected employees in ONE combined email
-- A combined send is logged as a single report_runs row with employee_id NULL.
-- NULLS NOT DISTINCT (Postgres 15+) keeps the once-per-period lock working for
-- that row too; a plain UNIQUE treats every NULL as different and would let a
-- combined report go out twice.

ALTER TABLE report_schedules ADD COLUMN IF NOT EXISTS combine_employees BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE report_runs ALTER COLUMN employee_id DROP NOT NULL;
ALTER TABLE report_runs DROP CONSTRAINT IF EXISTS report_runs_schedule_id_employee_id_period_key_key;
ALTER TABLE report_runs DROP CONSTRAINT IF EXISTS report_runs_once;
ALTER TABLE report_runs ADD CONSTRAINT report_runs_once
  UNIQUE NULLS NOT DISTINCT (schedule_id, employee_id, period_key);
