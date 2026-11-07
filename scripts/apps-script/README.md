# LeadSync.gs: Google Sheet → CRM

Copies the client's **Lead** tab into the CRM through `POST /api/v1/crm/leads/ingest`. The sheet only
feeds leads in; reps update statuses in the CRM (client, 7 Nov 2026).

> **Don't sort the lead sheet. Use filter views** (Data → Filter views). Sorting moves rows above the
> sync pointer; the hourly sweep catches them, but only up to an hour later.

## Triggers
`setup()` creates exactly these three, and only ever deletes these three:

| Handler | When | Does |
|---|---|---|
| `syncLeads` | every minute | Fast exit if nothing is new. Else: re-sends the retry list (one batch), then new rows below the pointer in batches of 50 for up to 4 min |
| `sweepUnsynced` | every hour | Sends every row above the pointer whose **CRM Sync** cell is blank (rows moved by a sort, inserted rows, cleared cells) |
| `reconcileYesterday` | daily ~00:15 IST | Yesterday's rows (by their own Timestamp) vs the server: re-sends what is missing, emails `OK n / n` or `MISMATCH n / m` every night |

No `onEdit` / `onChange` / `onFormSubmit` (they miss rows written by integrations and can't hold a
lock), and no run creates or deletes triggers: the pace is fixed. All three share one script lock;
a run that can't get it exits quietly (`tryLock(1000)`; the nightly job waits up to 60 s and alerts if it can't).

## Script properties (Project Settings → Script properties)
| Property | |
|---|---|
| `CRM_SECRET` | **Required.** Same value as `CRM_INGEST_SECRET` on the server (32+ characters; the server answers 503 otherwise). Read it on the droplet in your own terminal, never paste it in a chat. |
| `ALERT_EMAILS` | Comma-separated, e.g. `you@gmail.com,owner@maxmusicschool.co.in`. Empty = the account that installed the script. |
| `HC_SYNC_URL` | Healthchecks.io ping URL of the **sync** check (used by `syncLeads` and `sweepUnsynced`). |
| `HC_NIGHTLY_URL` | Healthchecks.io ping URL of the **nightly** check. |
| `API_BASE` | Optional override of the server address. Only on a test copy (tunnel URL + `/api/v1/crm`). |
| `TEST_MODE` | `true` on a test copy only. The script then **refuses to run** if the server address is production. |

The script also keeps `LAST_SYNCED_ROW` (the pointer), `RETRY`, `ALERT_*`, `RUN_MS_*`, `RUNS_*`, `SWEPT_*`.
To skip rows on purpose, put any text (e.g. `skipped`) in their CRM Sync cell.

## Install (a sheet editor, ~10 minutes)
0. First set the codes in CRM Settings → Statuses: old rows come in with their status.
1. Lead sheet → **Extensions → Apps Script**. Replace the editor's contents with `LeadSync.gs`; save.
2. **Project Settings** (gear): tick **Show "appsscript.json" manifest file in editor**, open
   `appsscript.json` in the editor and replace it with this folder's `appsscript.json` (time zone
   `Asia/Kolkata`); save.
3. **Script properties**: add the ones in the table above.
4. **Healthchecks.io** (free): create two checks, and under **Integrations** add **Email** and **Telegram**
   (Healthchecks → Integrations → Telegram → follow the bot link) to both:
   - *CallFlow Lead Sync*: Schedule **Simple**, Period **1 minute**, Grace **10 minutes** → `HC_SYNC_URL`
   - *CallFlow Nightly*: Period **1 day**, Grace **1 hour** → `HC_NIGHTLY_URL`
5. Editor → choose `setup` → **Run** → approve the permissions. Check the Triggers page: the three above.

**Upgrading the copy installed on 8 Nov:** paste the new `LeadSync.gs` over the old one, then do steps 2–5.
Move the ping URL you typed into `CONFIG.HEALTHCHECK_URL` into the `HC_SYNC_URL` property, and the old
`CONFIG.ALERT_EMAIL` into `ALERT_EMAILS`. `LAST_SYNCED_ROW` and every CRM Sync label stay as they are.

## What the CRM Sync column says
| Label | Meaning | Retried? |
|---|---|---|
| `synced 08 Nov 00:06 (LMS-106324)` | New lead created | – |
| `duplicate` | The server already had this row | – |
| `re-enquiry (LMS-105979)` | Same phone as an existing lead: that lead is reopened, no new lead | – |
| `invalid: Phone needs 10 digits` | Rejected by the server; marked once | No |
| `error: …` | The server failed on this row | Yes: the retry list, found again by its ID even if the row moved; up to 5 tries in all |
| `error (gave up after 5 tries): …` | One email is sent. Fix the cause and clear the cell; the sweep re-sends it | By the sweep, once the cell is clear |
| `… (retry list full)` | The retry list (~8 KB) was full; one email is sent | By the sweep, once the cell is clear |

A whole request that fails (401, 503, 5xx, timeout) writes nothing: those rows keep a blank cell, the
pointer doesn't move, and the next run sends them again.

Row IDs: the sheet has no Meta lead-ID column, so a row's ID is its Timestamp + Contact
(`sheet-20261107153000-9876543210`), which survives sorting and inserted rows. If an `id` column is
ever added, it is used instead.

## Alerts, heartbeat, run time
- **Error emails** go to `ALERT_EMAILS`, at most one per error *type* per hour (`http-401`,
  `timeout`, `guard`, …); the next one says how many repeats were suppressed. A failure while sending
  an alert never breaks a run.
- **Heartbeat**: every successful run pings its check, including runs with nothing new, so a quiet
  night doesn't look like a dead script. A caught error pings `/fail`, so the alert is immediate.
- **Nightly email**, every night, so a missing one is itself the alarm: rows in the sheet, leads in the
  CRM, missing IDs, re-send results, how many rows the sweep sent, the retry list size, and yesterday's
  total trigger run time and run count. Over **45 minutes** (half the ~90 min/day trigger quota of a free
  Gmail account) it adds: *consider changing the trigger to every 2 minutes*. The script never changes its
  own trigger. Counters reset after the report.

## Existing automation on this sheet (Triggers page, 8 Nov 2026)
| Handler | Type | Owner | Notes |
|---|---|---|---|
| `syncLeads` | Time-driven, every minute | the installer | This script |
| `reconcileYesterday` | Time-driven, daily ~00:15 IST | the installer | This script |
| `sweepUnsynced` | Time-driven, hourly | the installer | This script, after `setup()` is run again |
| `onFormSubmit` | From spreadsheet: On form submit | **another user** (name not shown) | Not ours. No `onFormSubmit` function exists in this project and it had no runs in the 7 days to 8 Nov, so it fails if the **Manual Leads** Google Form is submitted. Its owner should delete it, or restore their code as a separate file. `setup()` never touches it. |

## Testing
**Offline** (fake sheet, fake server, fake clock; no Google account or network):
`node scripts/apps-script/LeadSync.test.mjs` (13 tests covering every item of the spec).

**On a copy of the sheet against your local dev API.** Apps Script runs on Google's servers and can't
reach `localhost`, so the local API goes through a temporary tunnel:
1. Start the local stack (`apps/api`: `npm run crm:dev`, API on :4000). The local secret is
   `CRM_INGEST_SECRET` in `apps/api/.env.crm-dev`.
2. `brew install cloudflared`, then `cloudflared tunnel --url http://localhost:4000`. It prints
   `https://<random>.trycloudflare.com`. The local API is public while this runs: local demo data only,
   and stop it (Ctrl+C) when done.
3. In the lead sheet: **File → Make a copy** (the copy gets the script, but not its triggers or
   properties). In the copy, delete the data rows (keep row 1).
4. In the copy's Apps Script, Script properties: `TEST_MODE` = `true`, `API_BASE` =
   `https://<random>.trycloudflare.com/api/v1/crm`, `CRM_SECRET` = the local secret, `ALERT_EMAILS`
   = your email, and optionally `HC_SYNC_URL` / `HC_NIGHTLY_URL` from two separate *test* checks.
5. Run `setup` in the copy. Insert rows **by script** (`testInsertRows`, `testInsertDuplicate`), not by
   typing: typed rows hide the trigger problem this design exists to avoid.
6. Afterwards: delete the copy's triggers (or the copy), and stop the tunnel. A new tunnel gets a new URL.

With `TEST_MODE=true` the script refuses to run if `API_BASE` is the production domain, and the test
helpers refuse to run without `TEST_MODE`, so a test can never write to the live CRM or the live sheet.

### Test checklist (on the copy)
1. **New row:** run `testInsertRows` → within 2 minutes CRM Sync says `synced … (LMS-…)` and the lead is in the local CRM.
2. **Duplicate:** run `testInsertDuplicate` → the copy says `duplicate`; no second lead.
3. **Invalid:** type `91000` into a new row's Contact (typing is fine for this one) → `invalid: Phone needs 10 digits`, never retried.
4. **Wrong secret:** change `CRM_SECRET`, run `testInsertRows` twice, wait 10 min → **exactly one** email; cells stay blank. Put the secret back → the rows sync next minute.
5. **Suppressed count:** leave the wrong secret for over an hour → the second email says how many repeats were suppressed.
6. **Heartbeat:** delete the `syncLeads` trigger → the test sync check alerts (email + Telegram) within ~11 minutes. Run `setup` → the recovery notice arrives.
7. **Immediate /fail:** stop the tunnel → within a minute the check turns red (no waiting for the grace period) and one email arrives. Restart it, update `API_BASE` with the new URL.
8. **Sweep:** clear a synced row's CRM Sync cell, or sort the copy so new rows land above the pointer → within the hour they are re-sent (`duplicate` or `synced`).
9. **Nightly:** delete one of yesterday's test leads on the local server (`psql -h 127.0.0.1 -p 5433 callflow_dev -c "DELETE FROM leads WHERE external_id = '<id from the copy>'"`), run `reconcileYesterday` → email `MISMATCH n-1 / n`, the row is re-sent; run it again → `OK n / n`.
10. **Guard:** set `API_BASE` to the production address with `TEST_MODE=true`, run `syncLeads` → one email "refusing to run", nothing sent.
11. **Counters:** the next nightly email shows yesterday's sweep count, run time and run count; the `RUN_MS_*`, `RUNS_*`, `SWEPT_*` properties for that day are gone after it.
