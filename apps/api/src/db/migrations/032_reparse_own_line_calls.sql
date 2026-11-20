-- 20 Nov 2026: from 13:36 IST the KoreCall PBXs write the client's own line between the dashes
-- ({pbx line}-{his line}-B-…; office 2 = his lines 05–08). The receiver did not know that shape and stored
-- those calls as line 00, number Unknown, no rep. Re-read them from their filenames, the way the fixed
-- receiver now does: his line, the number, that line's rep and calling number, the student's name.
-- Only rows still marked unparsed with a non-empty middle number are touched, so running it twice is a no-op.
WITH m AS (
  SELECT id, regexp_match(split_part(source_file_key, '/', 3),
           '^(\d{2})-(\d+)-([AB])-(\d*)---(20\d{12})-.+\.wav$', 'i') r
  FROM calls
  WHERE misc_reason = 'Filename could not be fully parsed' AND line_number = '00'
), v AS (
  SELECT id, lpad(r[2], greatest(2, length(r[2])), '0') AS line,
         CASE WHEN upper(r[3]) = 'A' THEN 'inbound' ELSE 'outbound' END AS dir,
         coalesce(nullif(r[4], ''), 'Unknown') AS phone
  FROM m WHERE r IS NOT NULL
)
UPDATE calls c SET
  line_number    = v.line,
  call_direction = v.dir,
  caller_phone   = v.phone,
  employee_id    = (SELECT employee_id FROM lines WHERE line_number = v.line),
  calling_number = (SELECT phone_number FROM intercoms WHERE line_number = v.line LIMIT 1),
  student_name   = (SELECT name FROM students WHERE phone = v.phone LIMIT 1),
  misc_reason    = CASE WHEN c.is_misc THEN 'Short duration — possible disconnect' END
FROM v WHERE c.id = v.id;
