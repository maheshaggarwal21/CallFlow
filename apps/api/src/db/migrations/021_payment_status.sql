-- MIGRATION 021 — a status code on each school-site payment (client, 14 Nov 2026). Re-runnable.
-- Payments live on the school site, so only the status is kept here, by their payment id.
-- No row = code 1, so every payment starts on 1. The codes' names and colours are crm_settings 'pay_codes'.
CREATE TABLE IF NOT EXISTS payment_status (
  payment_id  VARCHAR(100) PRIMARY KEY,
  code        VARCHAR(2)   NOT NULL,
  updated_by  UUID REFERENCES employees(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
