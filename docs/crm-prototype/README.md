# CallFlow CRM (Leads + CRM Settings)

Branch `feature/crm-prototype`. A lead follow-up CRM inside CallFlow, cut down on the client's
request (7 Nov 2026, "keep it simple") to two pages:

- **Leads**: four tiles (total, new, follow-ups due today, converted), filters, a "due now" banner,
  and three lists: *Follow-up due now* (blinks 15 min before a callback), *Upcoming today*, *All leads*.
- **Lead form** (pop-up): number with Copy, name, email from the sheet, WhatsApp link, Status (the client's
  codes in a coloured dropdown), Guitar, next follow-up date/time, representative, amount, notes,
  a reminder banner, Save. A side handle opens the follow-up snapshot and the call log with recordings.
- **CRM Settings** (owner): **Statuses** (the sheet's letter codes: name and role of each, + Add status, follow-up wait,
  drop limit) and who may export leads.

Leads come from the Meta lead Google Sheet through `scripts/apps-script/LeadSync.gs`. Reps dial on
the KoreCall landline; the recording reaches CallFlow over FTP as before and is linked to the saved
form automatically (same number, same rep, within 30 minutes, in either order).

Everything is behind `CRM_ENABLED` (API) and `NEXT_PUBLIC_CRM_ENABLED` (web): merging exposes nothing
until both are set.

**Local runs cannot reach production:** every `crm:*` script preloads `apps/api/src/crmDevEnv.ts`,
which loads `apps/api/.env.crm-dev` before `apps/api/.env`, blanks R2 / Resend / WATI / Deepgram, and
exits unless the database host is `localhost` / `127.0.0.1`. The seed and DB tests check the host again.

## Statuses

The codes are the lead sheet's letters (any capital A–Z). The owner names each one in CRM Settings →
Statuses, picks its **role** (what Save does), and adds new ones with **+ Add status**. A letter that
arrives from the sheet but isn't set up is added automatically as "Not used" for the owner to name.
The client's codes (live since 7 Nov, migration 013):

| Code | Name | Role |
|---|---|---|
| A | Not picked | No contact, retry after 3 h |
| B | No guitar | Closed |
| C | Language issue | Closed |
| D | Talk to later | Talked, rep sets the follow-up |
| G | Interested | Talked, rep sets the follow-up |
| I | Not interested | Closed |
| N | Joined | Converted |

What each role does (the local demo uses its own codes A–G, shown on the right):

| Role | What happens on Save | Default codes |
|---|---|---|
| No contact · follows up by itself | Follow-up pre-filled after N hours or next day at HH:MM (per code), rep can change it; counts toward the drop limit | A Not reachable (6 h), B No response (3 h), C Call cut (next day 10:00) |
| Talked · rep sets the follow-up | Follow-up date + time required, note ≥ 15 characters | D Call later, E Will pay later |
| Converted (paid) | Note ≥ 15 characters; no follow-up; amount; recording kept past the 90-day cleanup | F Converted |
| Closed · no more calls | No follow-up; recording kept past the 90-day cleanup | G Not interested |
| Other (write what it does) | The owner types what it means; follow-up date/time optional (with one the lead comes back like a callback, without it the lead rests in All leads); no note or guitar required | — |
| Not used | Hidden from the form | — |

Plus **New** (not called yet). Leads are never dropped for unanswered calls (client, 7 Nov); the
owner can set a limit in Settings ("Stop calling a lead"), and then **Dropped** appears. Guitar is
required once the rep has spoken to the student. Changing a code's role moves the leads already on it.

## Run it locally (macOS)

```bash
# 0. Isolated toolchain (Postgres 16 + Node 20), nothing installed globally
V=~/Downloads/callflow/.crm-venv
CONDA_PKGS_DIRS=$V/pkgs conda create -y -p $V/env -c conda-forge --override-channels "postgresql=16" "nodejs=20"
cat > $V/activate.sh <<EOF
export CRM_VENV=$V PATH="$V/env/bin:\$PATH" PGDATA="$V/pgdata" PGHOST=127.0.0.1 PGPORT=5433 PGUSER=postgres
export npm_config_cache="$V/npm-cache" PLAYWRIGHT_BROWSERS_PATH="$V/ms-playwright"
EOF
source $V/activate.sh

# 1. Local Postgres (trust auth, listens on 127.0.0.1:5433 only)
initdb -U postgres -A trust -E UTF8 --locale=C
pg_ctl -l $V/postgres.log -o "-p 5433 -k /tmp -c listen_addresses=127.0.0.1" start
createdb callflow_dev

# 2. Env files (both gitignored)
cd CallFlow/apps/api
cat > .env.crm-dev <<EOF
NODE_ENV=development
PORT=4000
DATABASE_URL=postgresql://postgres@127.0.0.1:5433/callflow_dev
JWT_SECRET=$(openssl rand -hex 32)
WEB_ORIGIN=http://localhost:3000
CRM_ENABLED=true
CRM_INGEST_SECRET=$(openssl rand -hex 24)
EOF
printf 'NEXT_PUBLIC_API_BASE_URL=http://localhost:4000/api/v1\nNEXT_PUBLIC_CRM_ENABLED=true\n' > ../web/.env.local

# 3. Install, migrate, seed (ffmpeg on PATH makes the sample audio)
(cd ../../packages/shared-types && npm ci && npm run build)
npm ci && (cd ../web && npm ci)
npm run crm:migrate
npm run crm:reset-demo      # re-run right before every demo

# 4. Start (two terminals)
npm run crm:dev             # API on :4000 (prints "database host: 127.0.0.1")
cd ../web && npx next dev   # web on :3000
```

Logins (password `Demo@1234`): owner `owner@crm-demo.local`; reps `neha@ priya@ ritika@ anjali@ sneha@
pooja@ simran@crm-demo.local`. Neha may export leads. The seed puts one callback 10 minutes after
*now*, so reset right before showing it. Reset deletes only demo rows (staff `@crm-demo.local`, leads
`source='demo'`, calls `crmdemo/…`).

**Demo flow:** log in as Neha → the banner and blinking row → open the lead (Actions → ↗) → number
+ Copy, Status dropdown → log in as Priya in another browser, open the same lead (read-only, "Neha
Sharma is on this lead") → Neha picks *Call later*, date, time, note → History handle → Save →
owner → CRM Settings.

## Tests and walkthrough

```bash
cd apps/api && npm run crm:test     # 14 tests: rules, queue order, lock/409, matching both ways, intake, retention
cd apps/web && npm run type-check   # only the 4 older errors in overview/page.tsx remain
PLAYWRIGHT_MODULE=$CRM_VENV/pw/node_modules/playwright/index.mjs node docs/crm-prototype/demo-walkthrough.mjs
```
The walkthrough plays the demo flow and saves `screenshots/01-leads-page.png` … `07-crm-settings.png`;
it fails if any step fails. Playwright lives in `$CRM_VENV/pw` (`npm i playwright@1 && npx playwright install chromium`).

## Assumptions
- "Due now" = from 15 min before a callback to 15 min after; after that it is Overdue.
- Soft lock: 5 min, renewed every minute while the rep is active in the form; released on close or save.
  A save on a stale copy gets "This lead was updated by X, reload".
- Matching window ±30 min on the call's start time, same rep (from the KoreCall line), nearest wins,
  one recording per form. Errors in the matching trigger are logged to `crm_match_errors` and never
  block a recording.
- A new enquiry from a number already in the CRM reopens that lead as New (tag *re-enquired*), except
  a Converted lead, which only gets the tag and a history entry.
- "Reminder" means the lead blinks in *Follow-up due now*; no phone or WhatsApp notification is sent.
- The Representative chosen in the form is saved on every status; leads stay visible to every rep.

## Not done / limits
- `LeadSync.gs` is written and its server side tested, but not installed in a real sheet.
- Laptop widths (1280–1440 px) are tuned; phones are not.
- Dropped leads cannot be revived from the screen (open the lead and save a new status instead).

## Going to production
1. **Backup**, then run migrations `011_crm_1_core.sql` and `011_crm_2_calls.sql` **after calling hours**.
   `011_crm_2_calls.sql` adds the generated `calls.phone10` column, which **rewrites the whole `calls`
   table under an exclusive lock**: FTP inserts and dashboard reads wait until it finishes. It also
   installs the matching trigger.
2. **API env:** `CRM_ENABLED=true`, `CRM_INGEST_SECRET` (32+ characters; intake answers 503 otherwise).
3. **Web build:** `NEXT_PUBLIC_CRM_ENABLED=true` at build time (it is inlined).
4. **Retention:** the `planDeletions()` refactor is safe before or after the migration (`keep_audio` is
   read through `to_jsonb`). Run one dry run (`node dist/retention.js`) and compare with the last log.
5. **Never run `seedCrm.ts` in production** (it refuses a non-local host anyway).
6. **Statuses first:** the owner checks the names and roles, because the sheet import uses them.
7. **Apps Script:** follow `scripts/apps-script/README.md`. Old rows are imported with their status,
   rep, guitar and (converted only) amount, with no follow-up time: they show in All leads only.
