-- MIGRATION 024 — "show the saved password" (client, 15 Nov 2026). Re-runnable.
-- The login hash (bcrypt) is unchanged. `password_enc` is a second, REVERSIBLE copy, encrypted with a key that lives
-- only in the server's environment (PASSWORD_VIEW_KEY), so a copy of the database alone shows no password.
-- Only the Super Admin can reveal it, for Users and Admins. Passwords set before this existed have no copy.
ALTER TABLE employees ADD COLUMN IF NOT EXISTS password_enc TEXT;
