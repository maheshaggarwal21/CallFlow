-- MIGRATION 014 — CRM: per-employee access to the Leads tab and CRM Settings (client, 7 Nov 2026).
-- Until now every employee saw Leads; grant crm_leads to the active employees so nobody loses it.
-- CRM Settings stays owner-only until the owner ticks it for someone. Re-runnable.
ALTER TABLE employee_permissions DROP CONSTRAINT IF EXISTS employee_permissions_permission_check;
ALTER TABLE employee_permissions ADD CONSTRAINT employee_permissions_permission_check
  CHECK (permission IN ('crm_leads', 'crm_settings', 'export_leads'));

INSERT INTO employee_permissions (employee_id, permission)
SELECT id, 'crm_leads' FROM employees WHERE role = 'employee' AND status = 'active'
ON CONFLICT DO NOTHING;
