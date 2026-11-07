# LeadSync.gs — Google Sheet → CRM

Copies the client's "Lead" tab into the CRM through `POST /api/v1/crm/leads/ingest`
(every minute) and reconciles the previous day at 00:15. The sheet only feeds leads in;
reps update statuses in the CRM (client, 7 Nov 2026).

## Install (a sheet editor, ~5 minutes)
0. **First** set the codes in CRM Settings → Statuses and Save: old rows come in with their
   status, and each code's role decides it.
1. In the lead sheet: **Extensions → Apps Script**. Replace the editor's contents with
   `LeadSync.gs`, save. `CONFIG` is already set (server, "Lead" tab, columns, alerts to you).
2. **Project settings** (gear): time zone **(GMT+05:30) India Standard Time**; under
   **Script properties** add `CRM_SECRET` = the server's `CRM_INGEST_SECRET`.
3. Back in the editor choose `setup` → **Run** → approve the permissions. It installs the
   1-minute sync and the 00:15 reconcile.
4. Old rows import 200 a minute (~40 min for 8,100). Watch the new **CRM Sync** column fill
   (`synced … (created LMS-…)`). To skip old rows instead, add the script property
   `LAST_SYNCED_ROW` = the last row number before step 3.

## Behaviour
- Time-driven only (no onEdit/onFormSubmit). `LockService` prevents overlap; an idle
  run exits right after comparing `getLastRow()` with `LAST_SYNCED_ROW`.
- One request per run (up to 200 rows). Each row gets `synced <time> (created LMS-…)`,
  `(duplicate)`, `(reenquired …)` or `error: …` in the **CRM Sync** column.
- The server is idempotent on the row ID (the sheet has no id column, so Timestamp +
  Contact), so a re-run never duplicates; the same phone number re-opens the existing lead
  and tags it `re-enquired`, taking the newer row's status if it has one.
- Status, rep (matched to a CallFlow rep by name or first name), Guitar, and Amount (only
  for a converted code) are copied when the row is first synced. Later edits in the sheet
  are not synced: the reps work in the CRM.
- Old rows have no follow-up time, so they show in All leads only, not in the due lists.
- Errors email `ALERT_EMAIL` (empty = the installer's Google account) at most once per
  distinct error per hour. Optional: set `HEALTHCHECK_URL` to a healthchecks.io ping URL
  (1-minute period, ~5-minute grace) to be alerted if the sync stops silently.
