-- MIGRATION 015 — CRM: index for the Leads page's "Assigned to" filter (newest first).
-- leads is small (~8k rows), so a plain CREATE INDEX holds its lock for well under a second.
CREATE INDEX IF NOT EXISTS idx_leads_assigned ON leads (assigned_to, created_at DESC);
