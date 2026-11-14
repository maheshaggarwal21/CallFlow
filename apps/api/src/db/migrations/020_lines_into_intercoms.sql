-- MIGRATION 020 — the Lines tab was folded into Intercoms (client, 14 Nov 2026). Re-runnable.
-- Whoever had the Lines tab ticked gets Intercoms, where lines are now assigned; the old key goes.
INSERT INTO employee_permissions (employee_id, permission)
SELECT employee_id, 'intercoms' FROM employee_permissions WHERE permission = 'lines'
ON CONFLICT DO NOTHING;
DELETE FROM employee_permissions WHERE permission = 'lines';
