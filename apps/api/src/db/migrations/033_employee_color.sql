-- 20 Nov 2026: a colour per user, picked on the Codes tab; their name shows in it on the Recordings and Leads tabs.
ALTER TABLE employees ADD COLUMN IF NOT EXISTS color VARCHAR(7);
