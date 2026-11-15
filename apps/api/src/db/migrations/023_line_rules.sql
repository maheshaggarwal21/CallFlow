-- MIGRATION 023 — line and intercom rules (client, 15 Nov 2026). Re-runnable.
--  • One person per line, one line per person; switching someone off frees their line (the line has no agent)
--    and takes their intercom off the line, but the intercom KEEPS its calling number.
--  • `freed_at` is when a line last lost its agent: calls that arrive on it with no agent after that moment can be
--    given to the next agent (the calls are tagged when the recording arrives and never re-tagged by themselves).
ALTER TABLE lines ADD COLUMN IF NOT EXISTS freed_at TIMESTAMPTZ;

-- people already switched off still hold lines: free them now
WITH freed AS (
  UPDATE lines SET employee_id = NULL, assigned_at = NULL, freed_at = NOW()
  WHERE employee_id IN (SELECT id FROM employees WHERE status = 'inactive')
  RETURNING line_number
)
UPDATE intercoms SET line_number = NULL WHERE line_number IN (SELECT line_number FROM freed);
