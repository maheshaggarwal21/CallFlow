-- MIGRATION 013 — CRM: the client's own status codes (7 Nov 2026), and any letter A–Z allowed
-- so the owner can add codes in CRM Settings. Replaces the A–O placeholders from 011, which no
-- lead used yet. Roles of B, C, G are our reading of the names; the owner can change them.
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_current_code_check;
ALTER TABLE leads ADD CONSTRAINT leads_current_code_check CHECK (current_code ~ '^[A-Z]$');
ALTER TABLE lead_interactions DROP CONSTRAINT IF EXISTS lead_interactions_code_check;
ALTER TABLE lead_interactions ADD CONSTRAINT lead_interactions_code_check CHECK (code ~ '^[A-Z]$');

UPDATE crm_settings SET updated_at = NOW(), value =
  '{"A":{"label":"Not picked","role":"retry","hours":3},
    "B":{"label":"No guitar","role":"closed"},
    "C":{"label":"Language issue","role":"closed"},
    "D":{"label":"Talk to later","role":"callback"},
    "G":{"label":"Interested","role":"callback"},
    "I":{"label":"Not interested","role":"closed"},
    "N":{"label":"Joined","role":"paid"}}'
WHERE key = 'codes';
