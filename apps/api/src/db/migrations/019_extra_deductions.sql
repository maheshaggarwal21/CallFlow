-- MIGRATION 019 — extra deductions, simpler extra commissions (client, 13 Nov 2026). Re-runnable.
-- A deduction cuts ₹ or a % of the fix salary for a date range; an extra commission is now just
-- name, ₹ amount and dates, so the old rule fields (counts, reward, target, days, hours) are dropped.
ALTER TABLE employees ADD COLUMN IF NOT EXISTS extra_deductions JSONB NOT NULL DEFAULT '[]';
UPDATE employees SET extra_commissions = COALESCE((
  SELECT jsonb_agg(jsonb_build_object('name', x->'name', 'amount', x->'amount', 'from', x->'from', 'to', x->'to'))
  FROM jsonb_array_elements(extra_commissions) x), '[]')
WHERE extra_commissions <> '[]';
