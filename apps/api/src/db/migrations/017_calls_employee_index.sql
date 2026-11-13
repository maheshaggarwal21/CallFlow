-- MIGRATION 017 — one rep's calls in a date range (reports, salary, My Dashboard) used to read that rep's
-- whole call history through idx_calls_employee_id and then filter by date. Re-runnable.
-- Built without CONCURRENTLY so it runs inside migrate.ts; on ~100k calls the write lock lasts a second or two.
CREATE INDEX IF NOT EXISTS idx_calls_employee_called ON calls (employee_id, called_at);
-- The new index starts with employee_id, so the old single-column one is no longer needed.
DROP INDEX IF EXISTS idx_calls_employee_id;
