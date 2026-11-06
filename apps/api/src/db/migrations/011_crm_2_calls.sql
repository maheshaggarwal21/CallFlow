-- MIGRATION 011 (2/3) — CRM: link KoreCall recordings to leads
--
-- PRODUCTION NOTE: the generated phone10 column REWRITES the whole calls table
-- and holds an ACCESS EXCLUSIVE lock while it does (FTP inserts and dashboard
-- reads wait). Run this file after calling hours.

ALTER TABLE calls ADD COLUMN IF NOT EXISTS phone10 VARCHAR(10)
  GENERATED ALWAYS AS (NULLIF(right(regexp_replace(coalesce(caller_phone, ''), '\D', '', 'g'), 10), '')) STORED;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS lead_id UUID REFERENCES leads(id) ON DELETE SET NULL;
-- Retention never deletes audio for these (matched to an F or Z form, or starred by the owner)
ALTER TABLE calls ADD COLUMN IF NOT EXISTS keep_audio BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_calls_phone10_called ON calls (phone10, called_at DESC);
CREATE INDEX IF NOT EXISTS idx_calls_lead           ON calls (lead_id) WHERE lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_calls_keep_audio     ON calls (id) WHERE keep_audio;

-- Call → form matching. Fires when the FTP service inserts a recording and when
-- fixClockDrift.ts corrects called_at. Links the nearest unlinked form for the
-- same lead number by the same rep (calls.employee_id as stamped at ingest)
-- within ±30 min of the call's start, and stamps calls.lead_id.
-- It must NEVER block a recording: any error is logged to crm_match_errors.
CREATE OR REPLACE FUNCTION crm_link_call() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_lead UUID;
  v_form UUID;
BEGIN
  BEGIN
    IF NEW.phone10 IS NULL THEN RETURN NEW; END IF;
    SELECT id INTO v_lead FROM leads WHERE phone10 = NEW.phone10;
    IF v_lead IS NULL THEN RETURN NEW; END IF;

    IF NEW.employee_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM lead_interactions WHERE call_id = NEW.id) THEN
      SELECT i.id INTO v_form
      FROM lead_interactions i
      WHERE i.lead_id = v_lead AND i.kind = 'call_outcome' AND i.call_id IS NULL
        AND i.employee_id = NEW.employee_id
        AND i.created_at BETWEEN NEW.called_at - interval '30 minutes' AND NEW.called_at + interval '30 minutes'
      ORDER BY abs(extract(epoch FROM i.created_at - NEW.called_at))
      LIMIT 1
      FOR UPDATE SKIP LOCKED;
      IF v_form IS NOT NULL THEN
        UPDATE lead_interactions SET call_id = NEW.id WHERE id = v_form;
      END IF;
    END IF;

    -- Paid / never-call-again forms keep their recording past retention
    UPDATE calls c
    SET lead_id = v_lead,
        keep_audio = c.keep_audio OR EXISTS (
          SELECT 1 FROM lead_interactions i WHERE i.call_id = c.id AND i.code IN ('F','Z'))
    WHERE c.id = NEW.id;
  EXCEPTION WHEN OTHERS THEN
    BEGIN
      INSERT INTO crm_match_errors (call_id, error) VALUES (NEW.id, SQLSTATE || ': ' || SQLERRM);
    EXCEPTION WHEN OTHERS THEN
      NULL; -- even the log failing must not block the recording
    END;
  END;
  RETURN NEW;
END $$;

-- The UPDATE inside the function doesn't touch called_at, so it can't re-fire these.
DROP TRIGGER IF EXISTS crm_link_call_ins ON calls;
CREATE TRIGGER crm_link_call_ins AFTER INSERT ON calls
  FOR EACH ROW EXECUTE FUNCTION crm_link_call();
DROP TRIGGER IF EXISTS crm_link_call_upd ON calls;
CREATE TRIGGER crm_link_call_upd AFTER UPDATE OF called_at ON calls
  FOR EACH ROW WHEN (OLD.called_at IS DISTINCT FROM NEW.called_at) EXECUTE FUNCTION crm_link_call();
