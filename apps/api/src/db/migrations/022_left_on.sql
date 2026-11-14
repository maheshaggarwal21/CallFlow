-- MIGRATION 022 — the day someone was switched off (client, 14 Nov 2026). Re-runnable.
-- The Employee Tracker lists a person who left during a month for that month (greyed, salary pro-rated
-- to the days worked), and not after. Set when a user is switched off on the Users tab, cleared when
-- switched back on.
ALTER TABLE employees ADD COLUMN IF NOT EXISTS left_on DATE;
-- People switched off before this existed: their last call is the last day they worked.
-- Someone with no calls keeps no date and isn't listed, as before.
UPDATE employees e SET left_on = (SELECT MAX(c.called_at AT TIME ZONE 'Asia/Kolkata')::date FROM calls c WHERE c.employee_id = e.id)
WHERE e.status = 'inactive' AND e.left_on IS NULL;
