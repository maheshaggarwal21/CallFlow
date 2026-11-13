-- MIGRATION 016 — revamp (client, 12 Nov 2026): three access ranks, tabs as a per-user checklist,
-- the Users form's fields, and a line on each intercom. Re-runnable.

-- Ranks: owner = Super Admin, admin = Admin (sees everyone's data), employee = User (sees their own).
ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_role_check;
ALTER TABLE employees ALTER COLUMN role TYPE VARCHAR(12);
ALTER TABLE employees ADD CONSTRAINT employees_role_check CHECK (role IN ('owner', 'admin', 'employee'));

-- A permission is now any tab key (the list lives in apps/web/lib/tabs.ts), so the fixed list goes.
ALTER TABLE employee_permissions DROP CONSTRAINT IF EXISTS employee_permissions_permission_check;
-- Until now every employee saw Recordings: tick it once for them so nobody loses it.
INSERT INTO employee_permissions (employee_id, permission)
SELECT id, 'recordings' FROM employees
WHERE role = 'employee' AND NOT EXISTS (SELECT 1 FROM employee_permissions WHERE permission = 'recordings')
ON CONFLICT DO NOTHING;

-- Users form: designation, salary rule, daily targets. Reg No. is the existing employee_code.
ALTER TABLE employees ADD COLUMN IF NOT EXISTS designation             VARCHAR(60);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS fix_salary              INTEGER NOT NULL DEFAULT 0;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS trial_commission        NUMERIC(10,2) NOT NULL DEFAULT 0;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS trial_commission_type   VARCHAR(3) NOT NULL DEFAULT 'fix';
ALTER TABLE employees ADD COLUMN IF NOT EXISTS regular_commission      NUMERIC(10,2) NOT NULL DEFAULT 0;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS regular_commission_type VARCHAR(3) NOT NULL DEFAULT 'fix';
ALTER TABLE employees ADD COLUMN IF NOT EXISTS other_amount            INTEGER NOT NULL DEFAULT 0;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS target_call_secs        INTEGER NOT NULL DEFAULT 0;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS target_trial            INTEGER NOT NULL DEFAULT 0;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS target_regular          INTEGER NOT NULL DEFAULT 0;
-- Extra commissions (bonus rules) for this user, set on the Users form; shape checked in employees.routes.ts
ALTER TABLE employees ADD COLUMN IF NOT EXISTS extra_commissions       JSONB NOT NULL DEFAULT '[]';

-- Which line an intercom sits on, so picking one of line / intercom / number fills the other two.
ALTER TABLE intercoms ADD COLUMN IF NOT EXISTS line_number VARCHAR(5);
CREATE UNIQUE INDEX IF NOT EXISTS intercoms_line_number_key ON intercoms (line_number) WHERE line_number IS NOT NULL;
