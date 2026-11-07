-- MIGRATION 012 — CRM: never drop a lead for "no contact" calls (client, 7 Nov 2026).
-- 011 shipped with a limit of 6; max_attempts 0 means keep calling. Re-runnable.
UPDATE crm_settings SET value = jsonb_set(value, '{max_attempts}', '0'), updated_at = NOW()
WHERE key = 'retry_rules';
