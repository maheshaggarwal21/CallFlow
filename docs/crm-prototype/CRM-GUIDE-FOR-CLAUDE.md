# CallFlow CRM — guide

> **For Claude, reading this on the owner's behalf:** this file explains what was built and changed in
> the CallFlow repo for the lead CRM (6–7 Nov 2026) and how it works. The person giving it to you wants
> to *understand* it, not change it. Please:
> 1. Teach in layers: section 1 (big picture) and section 5 (flows) first, deeper only when asked.
>    Plain language; they own the project but are not a database expert.
> 2. For "how does X work", walk it in order: what the rep clicks → what the browser sends → what the
>    server checks → what the database stores → what the screen shows.
> 3. The code is the source of truth. If you have the repo, open the files in section 8 before answering,
>    and say so if something here no longer matches.
> 4. Offer a quiz or a flow diagram if it helps.

## Contents
1. The big picture
2. Words used here
3. How it got here (session history)
4. How production is protected
5. The flows, step by step
6. Database
7. API endpoints
8. File map
9. Running it, tests
10. Going to production
11. Good questions to ask

---

## 1. The big picture

**CallFlow before:** KoreCall PBX → FTP → CallFlow stores every call recording (R2) and shows them
on a dashboard with per-rep email reports. It had no idea *who* a number was or *why* it was called.

**The CRM adds:** the leads from Meta ads, one place to track each lead's status and next follow-up,
and the link between a rep's notes and the actual call recording.

What the client approved (after asking to "keep it simple"):
- **Leads page** — tiles (Total, New, Follow-ups due today, Converted), filters (search, status,
  representative, follow-up date, received date range), **Reset / Export** at the top, a yellow
  "Due in N minutes — moved to top automatically" banner, and three lists:
  **Follow-up due now** → **Upcoming today** → **All leads** (paged). Each row: #, received, name,
  contact, representative, status (code chip + label), amount, guitar, last contacted, follow-up
  date, time, alert (Due in N min / Overdue / Retry due), actions (WhatsApp, open form).
- **Lead form** — a compact pop-up: name, the **number in bold with Copy** at the top, **email** from
  the sheet, a WhatsApp button, **Status** (coloured dropdown of the codes in use), **Guitar**, **next follow-up
  date/time**, **Representative**, **Amount**, **Notes**, the **reminder banner** (siren) and **Save**.
  A vertical **History** handle on the right opens the follow-up snapshot and the call log with every
  recording of that number.
- **CRM Settings** (owner) — Statuses: the sheet's letter codes, each with a name and a role, + Add status; who may export leads.

Removed on the client's request: CRM Reports, bulk assign / My leads, WhatsApp templates (WATI),
reasons and note chips, extra questions, the daily paid-trials email, short-call auto-checks, lead
source and lead ID on screen.

## 2. Words used here

| Word | Meaning |
|---|---|
| **Lead** | One person who enquired, identified by their phone number. One row in `leads`. |
| **phone10** | Last 10 digits of a number. Matches `+91 94656 58112`, `09465658112` and `9465658112` as the same person. |
| **Status / code** | The outcome letter saved by the rep, one capital letter as on the lead sheet. Each has an owner-set name and **role** (`crm_settings.codes`): retry (no contact), callback (talked), paid, closed, other (owner's own description; follow-up optional), unused. Client's codes (013): A Not picked (retry 3 h), B No guitar, C Language issue, I Not interested (closed), D Talk to later, G Interested (callback), N Joined (paid). The local demo and tests use `DEFAULT_CODES` (A–C retry, D/E callback, F paid, G closed). A letter from the sheet that isn't in settings is added as unused. Plus "New" (never called) and "Dropped". |
| **Follow-up** | When to call next (`next_followup_at`). Rep-chosen for D/E; pre-filled from Settings for A/B/C. |
| **Due now / Overdue** | A D/E follow-up is *due* from 15 min before to 15 min after its time (row blinks), then *overdue*. |
| **Retry due** | An A/B/C lead whose wait is over. |
| **Dropped** | Off by default: the client keeps calling however many times (`retry_rules.max_attempts` = 0). If the owner sets a limit, that many no-contact saves in a row drop the lead. |
| **Representative** | Who should make the next call (`assigned_to`). Every rep still sees every lead. |
| **Lock** | While a rep has a lead open, others see it read-only ("Neha Sharma is on this lead"). 5 minutes, renewed while active. |
| **Version** | A counter on each lead. Saving an out-of-date copy gets "This lead was updated by X, reload". |
| **Matching** | Linking a saved form to its KoreCall recording: same number, same rep, within 30 min. |

## 3. How it got here (session history)

Same session, before the CRM:
1. **Backend `.env`** created from pasted production values; the Resend key copied from the droplet.
2. **Old droplet** (168.144.68.199) retired after confirming the new one (159.65.158.155) receives
   calls; its snapshot kept.
3. **Short-call analysis:** 19,051 outbound recordings of 10–29 s transcribed (Deepgram): **85–89% were
   never picked up**. KoreCall recordings start at dialling, so duration includes ringing.

The CRM:
1. **Full prototype** from the written spec (6 Nov): queue, lead drawer, soft lock, codes, two-way
   recording matching, WhatsApp templates (mock), reports, settings, Apps Script, assignment.
2. **Client review (7 Nov): "too much at this stage, keep it simple."** Marked-up screenshots showed
   what to keep. Cut to Leads + CRM Settings; columns and form fields per the mock.
3. **Polish rounds:** compact pop-up with History handle, colour-coded status dropdown, Actions column,
   Reset/Export in the header, lead source removed, number + Copy box, reminder above Save, one-box
   date range, received date without a label, email instead of contact in the form. **Approved.**
4. **Clean-up:** server code for everything removed was deleted (reports, digest email, WATI, call
   checks, bulk assign, revive, list editors), the migration trimmed, docs and walkthrough rewritten.

## 4. How production is protected

`apps/api/.env` points at **production** Supabase, R2 and Resend, so local work is fenced off:

| Layer | What it does |
|---|---|
| **Isolated toolchain** | Postgres 16, Node 20, npm cache and Playwright live in `~/Downloads/callflow/.crm-venv/` (outside the repo). `source ~/Downloads/callflow/.crm-venv/activate.sh` per terminal. |
| **Local database** | `callflow_dev` on `127.0.0.1:5433`, localhost only. |
| **Preload guard** | Every `npm run crm:*` runs `node -r ./dist/crmDevEnv.js …`: loads `.env.crm-dev` first, **blanks** R2/Resend/WATI/Deepgram/OpenAI keys, forces development mode, **exits unless the DB host is local** (`src/crmDevEnv.ts`, `src/lib/crm/localDb.ts`). |
| **Second guards** | `seedCrm.ts` and the DB tests check the host again. |
| **Fallbacks** | With R2 blank, audio comes from `apps/api/dev-uploads/`; with Resend blank, mail prints to the console. |
| **Demo markers** | Seeded rows: staff `@crm-demo.local`, leads `source='demo'`, calls `crmdemo/…`. Reset deletes only these. |
| **Feature flags** | `/api/v1/crm` mounts only with `CRM_ENABLED=true`; CRM pages and sidebar only with `NEXT_PUBLIC_CRM_ENABLED=true`. |

**Never run plain `npm run dev` in `apps/api` for CRM work** — that reads the production `.env`.

## 5. The flows, step by step

```
 Meta ad form ──► Google Sheet ──(LeadSync.gs, every minute)──► POST /crm/leads/ingest ──► leads
                                                                                            │
 Rep's browser: Leads page ◄── GET /crm/queue + /crm/leads (every 30 s) ───────────────────┤
                Lead form  ◄── GET /crm/leads/:id (lead + call log) ────────────────────────┤
                Save       ──► POST /crm/leads/:id/outcome ──► lead_interactions ───────────┤
 Rep dials on the KoreCall landline (reads the number, or Copy)                             │
 KoreCall ──FTP──► ftp-service (unchanged) ──► calls ──► trigger crm_link_call() links form ┘
```

### 5.1 A lead arrives
1. Meta writes the lead into the Google Sheet (existing).
2. `LeadSync.gs` runs every minute, sends new rows (id, created time, name, phone, **email**,
   campaign, platform) to `POST /api/v1/crm/leads/ingest` with the `X-CRM-Secret` header.
3. The server checks the secret (constant-time; 503 if not configured), works out `phone10`, then:
   - same sheet id seen before → **duplicate**, nothing changes (safe to re-send);
   - phone already a lead → **re-enquired**: back to New with a tag (a Converted lead only gets the tag);
   - invalid number → reported back, not stored;
   - otherwise → **created** as New.
4. The script writes the result into the sheet's **CRM Sync** column. Nightly at 00:15 it asks the
   server which of yesterday's ids are missing and re-sends them.

### 5.2 The Leads page
- Refreshes every 30 s. Order and "due" are decided on the **server's clock**.
- **Follow-up due now** = callbacks within 15 min + overdue callbacks + no-contact leads whose wait is
  over. **Upcoming today** = the rest of today's follow-ups. **All leads** = everything, newest first,
  sortable, paged.
- The banner names the next due callback; "View all due now" scrolls to the list.
- Export (owner, or reps given "Export leads") downloads the filtered list as CSV.

### 5.3 Opening a lead: the lock
1. Opening the pop-up claims a 5-minute lock (`POST /crm/leads/:id/lock`), renewed every minute while
   the rep types or moves the mouse; released on close or save.
2. A second rep opening it sees the yellow "… is on this lead" bar and a read-only form.
3. Every save sends the lead's **version**. If someone saved in between, the server answers
   "This lead was updated by X, reload" instead of overwriting.

### 5.4 Filling the form and Save
1. **Status** (required; codes marked Not used are hidden). Retry codes pre-fill the follow-up from their
   setting; paid/closed grey it out; callback codes need a date and time.
2. **Guitar** is required for callback/paid/closed. **Notes** need 15+ characters for callback/paid.
3. **Representative** defaults to the assigned rep, else whoever last worked the lead, else the user.
4. The **reminder banner** previews "[rep] will be reminded on [date at time]" as the date/time are picked.
5. **Save** (`POST /crm/leads/:id/outcome`), in one database transaction:
   - checks the lock and version, then the rules (`lib/crm/rules.ts`);
   - computes the new state from the code's role: retry → Retry (attempt count +1; Dropped only if a limit is set),
     callback → Callback, paid → Converted, closed → Do not call;
   - writes a history row in `lead_interactions` and updates the lead (status, code, follow-up,
     representative, guitar, amount, version +1, lock released);
   - tries to link the recording straight away (5.5).

### 5.5 Matching forms to recordings
Rule: **same phone10, same rep (`calls.employee_id` from the KoreCall line), call start within
±30 minutes of the save, neither already linked; nearest wins.**
- **Recording already there** when the form is saved → linked during the save.
- **Recording arrives later** (usual: FTP uploads come after the call, sometimes hours later) → the
  database trigger `crm_link_call()` on `calls` links it. The window is on the call's *start* time,
  so a late upload still matches.
- **Clock fixes:** `fixClockDrift.ts` corrects `called_at` later; the trigger also runs on that update.
- **Never blocks a recording:** trigger errors go to `crm_match_errors`; the recording saves normally.
- Links to a paid or closed code set `keep_audio = true`: the nightly 90-day cleanup skips those recordings.

### 5.6 History (the side panel)
- **Follow-up snapshot:** status, next date, time, assigned rep.
- **Call log:** every saved form and **every recording of that number by any rep**, newest first, each
  with a player (speed, download). Recordings with no form show "No form"; forms with no recording
  show "No recording found". The owner can star a recording to keep it past 90 days.

### 5.7 Settings
- **Statuses** (owner): name and role of each code, + Add status (saves merge, so a code is never removed, only set to Not used), the wait for retry codes (hours, or "next day at"),
  and "Stop calling a lead" (never, the default, or after N no-contact saves). Saving a new role moves leads on that code to the matching status
  (`reapplyCodeRoles`).
- **Who can export leads** (owner ticks reps). Checked against the database on every request.

## 6. Database

Migrations `apps/api/src/db/migrations/011_crm_1_core.sql` and `011_crm_2_calls.sql` (additive only):

| Table / column | Purpose |
|---|---|
| `leads` | One per person: name, email, phone_raw, **phone10 (unique)**, source/campaign (stored, not shown), sheet id, status, code, next_followup_at, attempts, last_contacted_at, amount, **has_guitar**, **assigned_to**, callback_set_by, tags, lock (`locked_by`, `locked_until`), **version**, `updated_by`. Codes look like `LMS-105901`. |
| `lead_interactions` | History: one row per save (`call_outcome`), re-enquiry or system note; `call_id` = linked recording (unique). |
| `employee_permissions` | Only `export_leads`. |
| `crm_settings` | `codes` (letter → label, role, wait) and `retry_rules` (drop limit, 0 = never). |
| `crm_match_errors` | Errors caught inside the matching trigger. |
| `calls.phone10` | Generated from `caller_phone`. **Adding it rewrites and locks `calls`** — run after hours. |
| `calls.lead_id`, `calls.keep_audio` | Set by matching; `keep_audio` protects from cleanup. |
| trigger `crm_link_call()` | On insert into `calls` and on update of `called_at`. |

## 7. API endpoints (`/api/v1/crm`, mounted only with `CRM_ENABLED=true`)

| Method & path | Who | What |
|---|---|---|
| `POST /leads/ingest` | Sheet script (secret) | Up to 500 rows (the script sends 200); idempotent on the row ID. |
| `POST /leads/reconcile` | Sheet script (secret) | Which ids are missing. |
| `GET /me` | Logged in | Permissions, owner or not. |
| `GET /config` | Logged in | Codes, representatives and drop limit for the form. |
| `GET /queue` | Logged in | Due now / overdue / retry / later lists + tile counts. |
| `GET /leads` | Logged in | All leads, filtered, sorted, paged. |
| `GET /leads/export.csv` | Owner or `export_leads` | CSV of the filtered list. |
| `GET /leads/:id` | Logged in | Lead + call log. |
| `POST /DELETE /leads/:id/lock` | Logged in | Claim / release the lock. |
| `POST /leads/:id/outcome` | Logged in | Save the form. |
| `GET /calls/:id/audio` | Logged in | Playback URLs for a lead's recording. |
| `POST /calls/:id/keep` | Owner | Star / unstar a recording. |
| `GET /settings`, `PATCH /settings/values/codes`, `PATCH /settings/values/retry_rules`, `PUT /settings/team/:id` | Owner (read: logged in) | Settings. |
| `POST /dev/simulate-lead` | Dev only | Fake lead for demos; 404 in production. |

## 8. File map

**API (`apps/api/src/`)**
- `crmDevEnv.ts`, `lib/crm/localDb.ts` — the local-only guard.
- `lib/crm/phone.ts` (phone10), `lib/crm/rules.ts` (codes, validation, next state, retry times),
  `lib/crm/queue.ts` (due / overdue / order).
- `services/crm.service.ts` — lock, save, matching at save time, lead detail, queue, intake, reconcile.
- `routes/crm.routes.ts` — the endpoints above. `middleware/requirePermission.ts`.
- `services/audioUrls.ts` — shared playback URLs (also used by `calls.routes.ts`).
- `lib/retentionPlan.ts` + `retention.ts` — cleanup skips `keep_audio` (separate commit, with test).
- `seedCrm.ts` — demo data; `lib/crm/logic.test.ts`, `lib/crm/db.test.ts` — tests.
- `index.ts` — mounts the CRM only with `CRM_ENABLED`.

**Web (`apps/web/`)**
- `app/dashboard/crm/page.tsx` — Leads page. `app/dashboard/crm/settings/page.tsx` — CRM Settings.
- `components/crm/LeadTable.tsx` — rows, alerts, actions. `components/crm/LeadDrawer.tsx` — the pop-up
  form, status dropdown, reminder banner, number box, lock. `components/crm/History.tsx` — snapshot,
  call log, player. `components/crm/kit.tsx` — shared pieces (Modal, CodeChip, StatusBadge, buttons).
- `lib/crm.ts` — codes, labels, types. `hooks/useCrmMe.ts` — permissions.
- Changed: `Sidebar.tsx`, `Topbar.tsx`, `middleware.ts` (CRM pages only with the flag), `lib/api.ts`
  (`put`), `components/ui/WABtn.tsx` (icon export).

**Other:** `scripts/apps-script/LeadSync.gs` + README; `docs/crm-prototype/README.md` (run + go-live),
`demo-walkthrough.mjs` (end-to-end check + screenshots).

## 9. Running it, tests

See `README.md` → "Run it locally". Logins: `owner@crm-demo.local` and `neha@` / `priya@` …
`@crm-demo.local`, password `Demo@1234`. Re-seed right before a demo: `npm run crm:reset-demo`.

Tests (`npm run crm:test`, 14): rule checks and next-state, queue order, retry times, phone parsing,
lock and stale-version 409, matching (save after recording; recording 2 h late; clock fixed by 2 h;
trigger error never blocks a recording), intake idempotency and re-enquiry, form save keeps
representative and guitar, retention equivalence. The walkthrough script plays the whole demo in a
browser and fails if any step fails.

## 10. Going to production

1. Backup; run `011_crm_1_core.sql` and `011_crm_2_calls.sql` **after calling hours** (the second
   rewrites and locks `calls` while it runs).
2. API env: `CRM_ENABLED=true`, `CRM_INGEST_SECRET` (32+ chars). Web build: `NEXT_PUBLIC_CRM_ENABLED=true`.
3. Retention dry run; compare with the previous night.
4. Owner checks Statuses, then install `LeadSync.gs` in the real sheet (`scripts/apps-script/README.md`):
   it imports every old row with its status, rep, guitar and amount, then new rows each minute.
5. Decided 7 Nov: reps update statuses in the CRM only; the sheet just feeds new leads in.

## 11. Good questions to ask

- "Walk me through what happens when Neha opens a lead, picks Call later and saves."
- "How does a recording that arrives 2 hours later still find its form?"
- "What stops two reps calling the same student at the same time?"
- "What's the difference between the Representative and the lock?"
- "Why can't my laptop accidentally change the live database?"
- "What has to happen, in order, to put this live — and what could go wrong?"
