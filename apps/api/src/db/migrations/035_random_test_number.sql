-- Each line test gets its own random number to dial (client, 28 Nov 2026), so the recording itself says whose test it
-- is; offices no longer need a test number (teams.test_number is left unused).
ALTER TABLE line_sessions ADD COLUMN IF NOT EXISTS test_number VARCHAR(15);
