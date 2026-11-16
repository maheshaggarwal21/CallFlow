-- The Meta lead form's new question "Select your preferred class time" (client, 16 Nov 2026), read from the lead
-- sheet with "Do you have a guitar?". Free text as the student picked it. Re-runnable.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS preferred_class_time VARCHAR(100);
