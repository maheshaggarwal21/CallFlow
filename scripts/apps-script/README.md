# LeadSync.gs — Google Sheet → CRM (not deployed)

Copies new Meta lead rows from the reps' Google Sheet into the CRM through
`POST /api/v1/crm/leads/ingest`, and reconciles each day at 00:15.

## Install (when the CRM goes live)
1. In the lead sheet: **Extensions → Apps Script**, paste `LeadSync.gs`.
2. Edit `CONFIG`: `API_BASE`, `SHEET_NAME`, `HEALTHCHECK_URL` (create a check at
   healthchecks.io with a 1-minute period and ~5-minute grace), `ALERT_EMAIL`, and
   the `COLUMNS` header names if the sheet differs from Meta's defaults.
3. **Project settings → Script properties**: add `CRM_SECRET` = the server's
   `CRM_INGEST_SECRET` (at least 32 characters; the API answers 503 otherwise).
4. Set the project time zone to **Asia/Kolkata**, then run `setup()` once and
   approve the permissions. It installs the 1-minute sync and the 00:15 reconcile.
5. Before the first run, set the script property `LAST_SYNCED_ROW` to the last row
   already worked in the sheet, or every old row is imported.

## Behaviour
- Time-driven only (no onEdit/onFormSubmit). `LockService` prevents overlap; an idle
  run exits right after comparing `getLastRow()` with `LAST_SYNCED_ROW`.
- One request per run (up to 500 rows). Each row gets `synced <time> (created LMS-…)`,
  `(duplicate)`, `(reenquired …)` or `error: …` in the **CRM Sync** column.
- The server is idempotent on the sheet's `id` column, so a re-run never duplicates;
  the same phone number re-opens the existing lead and tags it `re-enquired`.
- Errors email `ALERT_EMAIL` at most once per distinct error per hour; Healthchecks.io
  alerts if the pings stop.
