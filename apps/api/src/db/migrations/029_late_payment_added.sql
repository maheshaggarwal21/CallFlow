-- "Add to this month" on a late payment (client, 17 Nov 2026): the Super Admin adds the commission of payments that
-- arrived after their month closed as an extra commission in the current month; these mark them as done so the
-- same payment can't be added twice. Re-runnable.
ALTER TABLE late_payments ADD COLUMN IF NOT EXISTS added_month CHAR(7);
ALTER TABLE late_payments ADD COLUMN IF NOT EXISTS added_at TIMESTAMPTZ;
ALTER TABLE late_payments ADD COLUMN IF NOT EXISTS added_by UUID REFERENCES employees (id) ON DELETE SET NULL;
