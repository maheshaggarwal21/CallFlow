# LeadSync.gs — Google Sheet → CRM (not deployed)

Copies new Meta lead rows from the reps' Google Sheet into the CRM through
`POST /api/v1/crm/leads/ingest`, and reconciles each day at 00:15.

## Install (when the CRM goes live)
1. In the lead sheet: **Extensions → Apps Script**, paste `LeadSync.gs`.
2. Edit `CONFIG`: `API_BASE`, `HEALTHCHECK_URL` (create a check at healthchecks.io with
   a 1-minute period and ~5-minute grace) and `ALERT_EMAIL`. `SHEET_NAME` and `COLUMNS`
   are already set for the client's "Lead" tab (Timestamp, Name, Contact, Email, Source,
   rep in column F, Status, Amount, Guitar).
3. **Project settings → Script properties**: add `CRM_SECRET` = the server's
   `CRM_INGEST_SECRET` (at least 32 characters; the API answers 503 otherwise).
4. Set the project time zone to **Asia/Kolkata**, then run `setup()` once and
   approve the permissions. It installs the 1-minute sync and the 00:15 reconcile.
5. **Before** `setup()`, set the codes in CRM Settings → Statuses: old rows come in with
   their status, and a code's role decides it. Then leave `LAST_SYNCED_ROW` unset (or 1) to
   bring in every old row, 500 a minute (~17 min for 8,100 rows), or set it to the last row
   to skip the old ones.

## Behaviour
- Time-driven only (no onEdit/onFormSubmit). `LockService` prevents overlap; an idle
  run exits right after comparing `getLastRow()` with `LAST_SYNCED_ROW`.
- One request per run (up to 500 rows). Each row gets `synced <time> (created LMS-…)`,
  `(duplicate)`, `(reenquired …)` or `error: …` in the **CRM Sync** column.
- The server is idempotent on the row ID (the sheet has no id column, so Timestamp +
  Contact), so a re-run never duplicates; the same phone number re-opens the existing lead
  and tags it `re-enquired`, taking the newer row's status if it has one.
- Status, rep (matched to a CallFlow rep by name or first name), Guitar, and Amount (only
  for a converted code) are copied when the row is first synced. Later edits in the sheet
  are not synced (the client is still deciding: CRM or sheet for daily work).
- Old rows have no follow-up time, so they show in All leads only, not in the due lists.
- Errors email `ALERT_EMAIL` at most once per distinct error per hour; Healthchecks.io
  alerts if the pings stop.
