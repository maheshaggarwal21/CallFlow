-- MIGRATION 014 — CRM: per-employee access to the Leads tab and CRM Settings (client, 7 Nov 2026).
-- Until now every employee saw Leads; grant crm_leads to the active employees so nobody loses it.
-- CRM Settings stays owner-only until the owner ticks it for someone. Re-runnable: the grant only
-- happens while nobody holds crm_leads, so a later run never re-ticks a tab the owner unticked.
-- (The fixed permission list this file used to re-add is gone: migration 016 makes every tab a permission.)
ALTER TABLE employee_permissions DROP CONSTRAINT IF EXISTS employee_permissions_permission_check;

INSERT INTO employee_permissions (employee_id, permission)
SELECT id, 'crm_leads' FROM employees
WHERE role = 'employee' AND status = 'active' AND NOT EXISTS (SELECT 1 FROM employee_permissions WHERE permission = 'crm_leads')
ON CONFLICT DO NOTHING;
