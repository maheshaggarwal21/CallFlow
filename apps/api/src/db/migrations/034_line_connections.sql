-- MIGRATION 034 — employee login and line connections (client, 28 Nov 2026; docs/EMPLOYEE-LOGIN-PLAN.md).
-- Teams are shown as Offices; each office has a test number reps dial to prove their phone is wired to the line they
-- picked. A line (a "connection") belongs to an office and has a calling number. line_sessions keeps every test and
-- connection. lines.employee_id stays the one place the FTP receiver reads the rep from. Re-runnable.

ALTER TABLE teams ADD COLUMN IF NOT EXISTS test_number VARCHAR(15);

-- each person's own phone is unique (the employee login shows it, masked, as their contact); compared on the last
-- 10 digits so +91 98… and 98… are the same. Prod had no duplicates on 28 Nov 2026.
CREATE UNIQUE INDEX IF NOT EXISTS uq_employees_phone ON employees ((right(regexp_replace(phone, '\D', '', 'g'), 10))) WHERE phone IS NOT NULL;

ALTER TABLE lines ADD COLUMN IF NOT EXISTS team_id UUID REFERENCES teams(id) ON DELETE SET NULL;
ALTER TABLE lines ADD COLUMN IF NOT EXISTS calling_number VARCHAR(15);
-- the number each line has today lives on its intercom; copy it so nothing looks emptier
UPDATE lines l SET calling_number = i.phone_number
FROM intercoms i WHERE i.line_number = l.line_number AND l.calling_number IS NULL AND i.phone_number IS NOT NULL;

CREATE TABLE IF NOT EXISTS line_sessions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  line_id        UUID REFERENCES lines(id) ON DELETE SET NULL,
  line_number    VARCHAR(5)  NOT NULL,
  calling_number VARCHAR(15),
  team_id        UUID REFERENCES teams(id) ON DELETE SET NULL,
  employee_id    UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  status         VARCHAR(10) NOT NULL CHECK (status IN ('testing', 'connected', 'ended', 'failed')),
  via            VARCHAR(10) NOT NULL DEFAULT 'test' CHECK (via IN ('test', 'admin')),
  started_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  connected_at   TIMESTAMPTZ,
  ended_at       TIMESTAMPTZ,
  end_reason     VARCHAR(60),
  test_call_id   UUID REFERENCES calls(id) ON DELETE SET NULL,
  -- the rep's last touch on the dashboard (idle logout after 45 min, client 28 Nov 2026)
  last_seen_at   TIMESTAMPTZ
);
ALTER TABLE line_sessions ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;
-- one rep per line, one open test per line, and one open test or connection per rep
CREATE UNIQUE INDEX IF NOT EXISTS uq_line_sessions_line_connected ON line_sessions (line_id) WHERE status = 'connected';
CREATE UNIQUE INDEX IF NOT EXISTS uq_line_sessions_line_testing   ON line_sessions (line_id) WHERE status = 'testing';
CREATE UNIQUE INDEX IF NOT EXISTS uq_line_sessions_employee_open  ON line_sessions (employee_id) WHERE status IN ('testing', 'connected');
CREATE INDEX IF NOT EXISTS idx_line_sessions_employee ON line_sessions (employee_id, started_at DESC);

-- Whatever changes a line's rep (Free line, the Users form, switching someone off, swap) keeps line_sessions in step:
-- the old rep's connection ends, and a rep put on by hand gets a connection marked via = 'admin'.
CREATE OR REPLACE FUNCTION sync_line_sessions() RETURNS trigger AS $$
BEGIN
  IF NEW.employee_id IS NOT DISTINCT FROM OLD.employee_id THEN RETURN NEW; END IF;
  UPDATE line_sessions SET status = 'ended', ended_at = NOW(), end_reason = COALESCE(end_reason, 'line freed')
   WHERE line_id = NEW.id AND status = 'connected' AND employee_id IS DISTINCT FROM NEW.employee_id;
  IF NEW.employee_id IS NOT NULL THEN
    -- someone else testing this line, or this rep's other open test or connection, stops here
    UPDATE line_sessions SET status = CASE WHEN status = 'testing' THEN 'failed' ELSE 'ended' END,
           ended_at = NOW(), end_reason = COALESCE(end_reason, 'line given to someone else')
     WHERE status IN ('testing', 'connected')
       AND ((line_id = NEW.id AND employee_id <> NEW.employee_id) OR (employee_id = NEW.employee_id AND line_id IS DISTINCT FROM NEW.id));
    IF NOT EXISTS (SELECT 1 FROM line_sessions WHERE line_id = NEW.id AND employee_id = NEW.employee_id AND status = 'connected') THEN
      UPDATE line_sessions SET status = 'failed', ended_at = NOW(), end_reason = 'connected by admin'
       WHERE line_id = NEW.id AND employee_id = NEW.employee_id AND status = 'testing';
      INSERT INTO line_sessions (line_id, line_number, calling_number, team_id, employee_id, status, via, connected_at)
      VALUES (NEW.id, NEW.line_number, NEW.calling_number, NEW.team_id, NEW.employee_id, 'connected', 'admin', NOW());
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_line_sessions ON lines;
CREATE TRIGGER trg_sync_line_sessions AFTER UPDATE OF employee_id ON lines
  FOR EACH ROW EXECUTE FUNCTION sync_line_sessions();
