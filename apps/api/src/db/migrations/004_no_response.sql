-- MIGRATION 004 — Add 'no_response' to resolution_status allowed values

ALTER TABLE calls DROP CONSTRAINT IF EXISTS calls_resolution_status_check;

ALTER TABLE calls ADD CONSTRAINT calls_resolution_status_check
  CHECK (resolution_status IN ('resolved', 'escalated', 'no_response'));

-- Back-fill existing misc/short calls as no_response
UPDATE calls
SET resolution_status = 'no_response'
WHERE is_misc = TRUE AND resolution_status IS NULL;
