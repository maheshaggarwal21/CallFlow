-- MIGRATION 030 — each call keeps the calling number its line had when the recording arrived (client, 19 Nov 2026).
-- Before, the call details showed the number the line's intercom has today, so changing a line's number rewrote old
-- calls. Existing calls get the number they show today. Re-runnable. (The calls trigger fires only on called_at.)
ALTER TABLE calls ADD COLUMN IF NOT EXISTS calling_number VARCHAR(15);

UPDATE calls c SET calling_number = COALESCE(
    (SELECT i.phone_number FROM intercoms i WHERE i.intercom_code = c.intercom_code),
    (SELECT li.phone_number FROM intercoms li WHERE c.intercom_code IS NULL AND li.line_number = c.line_number LIMIT 1))
WHERE c.calling_number IS NULL
  AND (c.intercom_code IN (SELECT intercom_code FROM intercoms WHERE phone_number IS NOT NULL)
       OR c.line_number IN (SELECT line_number FROM intercoms WHERE phone_number IS NOT NULL));
