-- MIGRATION 018 — teams (client, 13 Nov 2026): the owner runs offices in two or more places and splits
-- the agents into teams. One team per agent; deleting a team leaves its agents without one. Re-runnable.
CREATE TABLE IF NOT EXISTS teams (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(60) NOT NULL UNIQUE,
  location    VARCHAR(60),
  color_index INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS team_id UUID REFERENCES teams(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_employees_team ON employees (team_id) WHERE team_id IS NOT NULL;
