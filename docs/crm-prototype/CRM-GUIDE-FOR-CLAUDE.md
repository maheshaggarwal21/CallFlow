# CallFlow CRM prototype — complete guide

> **For Claude, reading this on the owner's behalf:** this file describes everything that was
> built and changed in the CallFlow repo during one long working session (6 Nov 2026), and how it
> all works. The person giving it to you wants to *understand* it, not change it. Please:
> 1. Teach it in layers: start with section 1 (the big picture) and section 6 (flows), then go
>    deeper only where they ask. Use plain language; they are the project owner, not a database expert.
> 2. When they ask "how does X work", walk the flow in order (what the rep clicks → what the
>    browser sends → what the server checks → what the database stores → what the screen shows).
> 3. The code is the source of truth. If you have the repo, open the files named in section 9 to
>    confirm details before answering, and say so if something here no longer matches the code.
> 4. Offer to quiz them or draw a flow diagram if it helps.

---

## Contents
1. [The big picture](#1-the-big-picture)
2. [Words used in this guide](#2-words-used-in-this-guide)
3. [Everything done in this session, in order](#3-everything-done-in-this-session-in-order)
4. [How production is protected](#4-how-production-is-protected)
5. [Architecture: the moving parts](#5-architecture-the-moving-parts)
6. [The flows, step by step](#6-the-flows-step-by-step)
7. [Database: tables and columns added](#7-database-tables-and-columns-added)
8. [API endpoints](#8-api-endpoints)
9. [File-by-file map](#9-file-by-file-map)
10. [Commits on the branch](#10-commits-on-the-branch)
11. [Running the demo](#11-running-the-demo)
12. [Tests](#12-tests)
13. [Assumptions, pending decisions, limits](#13-assumptions-pending-decisions-limits)
14. [Going to production](#14-going-to-production)
15. [Good questions to ask Claude about this](#15-good-questions-to-ask-claude-about-this)

---

## 1. The big picture

**CallFlow** (already in production) is Max Music School's call-recording system. The office
phone system (a KoreCall PBX) uploads every call recording over FTP after the call ends. CallFlow
stores the audio (Cloudflare R2), saves a row per call in Postgres (Supabase), and shows it in a
web dashboard (Next.js) with reports.

**The problem the CRM solves.** 6–7 telecallers ("reps") work Meta ad leads (100–200 a day) in a
shared Google Sheet. There is no shared view of who called whom, what was said, when to call
back, or whether a "paid" claim matches a real call.

**What the CRM prototype adds** (inside CallFlow, as a new "CRM" section in the sidebar):

- A **shared lead pool** (the Lead Queue) every rep works from, ordered by urgency.
- A **lead form** ("Lead follow-up" sheet) where a rep records the outcome of a call with the
  client's own codes **A–F, Z**, a reason, notes, and a callback time.
- **Callbacks that blink** for every rep 15 minutes before they are due.
- A **full history per phone number** across all reps: every form, WhatsApp message and every
  KoreCall recording of that number, playable.
- **Automatic matching** of each form to its KoreCall recording (by phone number, rep and time).
- **Assignment**: the owner can give leads to a rep; reps see "My leads".
- **WhatsApp templates** through WATI (mock mode until credentials arrive).
- **CRM Reports** with charts, plus a "Checks" tab listing anything suspicious (forms with no
  recording, recordings with no form, typo'd numbers, codes that contradict the call).
- A daily **"paid trials" email digest** to the owner.
- **Settings** the owner controls: questions, reasons, note templates, retry rules, permissions.

**Status:** a working **localhost prototype** for a client demo, on git branch
`feature/crm-prototype` (13 commits, **not pushed, not merged, not deployed**). It is switched off
by default even if merged (two feature flags), and it was built so it **cannot touch production
data** while running locally.

---

## 2. Words used in this guide

| Word | Meaning |
|---|---|
| **Lead** | One enquiry (a person + phone number) from a Meta ad. Table `leads`. Has a code like `LMS-106404`. |
| **Rep** | A telecaller (employee role). The **owner** is the boss account. |
| **Form / outcome / interaction** | What a rep saves after a call. Table `lead_interactions` (kind `call_outcome`). Also used for WhatsApp sends, re-enquiries and system notes. |
| **Recording / call** | A KoreCall recording row in the existing `calls` table. |
| **phone10** | The last 10 digits of a phone number with everything else removed. `+91 94656 58112`, `09465658112`, `919465658112` all become `9465658112`. The single matching key. |
| **Codes A–F, Z** | The client's outcome codes (section 6.4). |
| **Callback** | A D or E outcome with a promised date + time to call again. |
| **Due now** | A callback from 15 min before its time until 15 min after. Blinks. |
| **Lock** | A 5-minute "I'm on this lead" claim so two reps don't call the same student. |
| **Version** | A counter on each lead; saving with an old version is rejected (409) so nobody overwrites someone else's update. |
| **Assigned to** | The rep who should make the next call. |
| **Callback set by** | The rep who spoke to the student and agreed the callback time. |
| **WATI** | The WhatsApp Business API provider. **Mock mode** = nothing is really sent. |
| **Retention** | The nightly job that deletes audio older than 90 days from R2. |
| **keep_audio** | A flag on a call that stops retention deleting its audio. |
| **Call check** | A label for short calls (busy / no answer / switched off…). Preview data only in the prototype. |
| **PBAC** | Permission-based access: per-rep permission flags set by the owner. |

---

## 3. Everything done in this session, in order

Not all of it is CRM. Earlier in the same session:

1. **Backend `.env`** — created `apps/api/.env` from pasted values (production credentials).
   Later the **Resend API key** was copied into it from the new droplet (the CSV export from
   Resend only contained a truncated key). This file is gitignored.
2. **Old droplet decommission** — confirmed the new droplet (159.65.158.155) was receiving
   same-day PBX calls; the old droplet (168.144.68.199) was unreachable; it had a snapshot
   (`callflow-old-final`). Guided destroying it while keeping the snapshot.
3. **Short-call analysis (R2 scan)** — transcribed every outbound recording of 10–29 seconds still
   in R2 (19,051 calls, Deepgram, ~$30) and classified them. Result: **85–89% were never picked
   up** (ringing, busy, switched off, invalid, voicemail); only ~3–5% were real conversations.
   Key insight: **KoreCall recordings start at dialling**, so call duration includes ringing and
   operator messages. That is why the CRM's "conversation" metric is
   *"Likely conversations (≥30 s, coded D/E/F/Z)"* and not just "calls over 30 s". A per-call CSV
   was saved to `~/Downloads/callflow/short-calls-10-29s-breakdown.csv`.
4. **The CRM prototype** — everything else in this guide. Built from a detailed written spec,
   then reshaped through feedback:
   - spec build: safety layer → retention refactor → migrations → API → queue + drawer → reports
     → settings → Apps Script → docs + Playwright walkthrough;
   - redesign of the lead form to follow the client's mock ("sir's sample") in our style;
   - lead form extras: WATI connected pill, representative field, follow-up presets, siren
     banner, glowing timeline, preview toggle, "Save form";
   - CRM Reports redesigned into tabs with charts, mismatches moved to a "Checks" tab;
   - lead **assignment**: bulk assign in All Leads, "My leads" tab, and an owner "Lead
     assignment" box inside the lead form showing current and previous assignee.

---

## 4. How production is protected

The repo's `apps/api/.env` points at **production** Supabase, R2 and Resend. The prototype was
built so local work can never reach them:

| Layer | What it does | Where |
|---|---|---|
| **Isolated toolchain** | Postgres 16 + Node 20 + npm cache + Playwright browser live in `~/Downloads/callflow/.crm-venv/` (a conda prefix env, outside the repo). Nothing installed globally. `source ~/Downloads/callflow/.crm-venv/activate.sh` in each terminal. | outside repo |
| **Local database** | `callflow_dev` on `127.0.0.1:5433`, listening on localhost only. | `.crm-venv/pgdata` |
| **Dev env file** | `apps/api/.env.crm-dev` (gitignored): local `DATABASE_URL`, dev `JWT_SECRET`, `CRM_ENABLED=true`, `CRM_INGEST_SECRET`. | `apps/api/.env.crm-dev` |
| **Preload guard** | Every `npm run crm:*` script runs `node -r ./dist/crmDevEnv.js …`. It loads `.env.crm-dev` *before* anything reads `.env`, **blanks** R2 / Resend / WATI / Deepgram / OpenAI keys (dotenv never overwrites an existing key, so `.env` can't refill them), forces `NODE_ENV=development`, then **exits unless the DB host is localhost / 127.0.0.1**. | `apps/api/src/crmDevEnv.ts`, `src/lib/crm/localDb.ts` |
| **Second guards** | `seedCrm.ts` and the DB tests check the host again themselves. | |
| **Storage fallback** | With R2 blank, audio is read from `apps/api/dev-uploads/` (gitignored) instead of R2. | existing `storage.service.ts` |
| **Mail fallback** | With Resend blank, emails print to the console. | existing `mail.service.ts` |
| **Demo markers** | Every seeded row is marked: staff `@crm-demo.local`, leads `source='demo'`, calls `source_file_key LIKE 'crmdemo/%'`, lines `purpose='crm-demo'`. Reset deletes **only** by these markers. | `seedCrm.ts` |
| **Feature flags** | API: `/api/v1/crm` only mounts when `CRM_ENABLED=true`. Web: the CRM sidebar and `/dashboard/crm*` pages only exist when `NEXT_PUBLIC_CRM_ENABLED=true`. Merging the code exposes nothing until both are set. | `index.ts`, `middleware.ts`, `Sidebar.tsx` |
| **Schedulers** | The F-digest email scheduler only starts in production *and* with `CRM_ENABLED=true`. | `crmReports.service.ts` |

**Never run plain `npm run dev` in `apps/api` for CRM work** — that reads the production `.env`.

This was verified at the end: the running API had no outbound connections, its DB host was
`127.0.0.1:5433`, and R2/Resend/WATI/Deepgram values were empty.

---

## 5. Architecture: the moving parts

```
 Meta ad form
      │ (Meta → Google Sheet integration, existing)
      ▼
 Google Sheet (reps' current sheet)
      │  scripts/apps-script/LeadSync.gs  — every minute, one batch, secret header
      ▼
 POST /api/v1/crm/leads/ingest ──────────────► leads table (shared pool)
                                                    │
 Rep's browser (Next.js, /dashboard/crm)            │
   Lead Queue ◄── GET /crm/queue (every 30 s) ──────┤
   Lead form  ◄── GET /crm/leads/:id  (history) ────┤
   Save       ──► POST /crm/leads/:id/outcome ──────┤──► lead_interactions (forms)
   WhatsApp   ──► POST /crm/leads/:id/whatsapp ─────┤──► wati.service (mock or WATI API)
                                                    │
 Rep dials on the KoreCall LANDLINE (no click-to-dial)
      │ after the call ends
      ▼
 KoreCall PBX ──FTP──► ftp-service (existing) ──► calls table (+ R2 audio)
                                                    │
              Postgres trigger crm_link_call() ─────┘ links the recording to the form
                                                       (same number, same rep, ±30 min)

 Owner: CRM Reports (GET /crm/reports), Settings, All Leads + assign, daily paid digest email
```

Key design choices:
- **No click-to-dial / no live PBX link.** Reps read the big number and dial by hand.
  Recordings only arrive *after* a call, so the CRM matches them afterwards.
- **Matching is in two directions** so it works whichever arrives first (the form or the recording).
- **The server decides time-based things** (what is "due", queue order) using its own clock, never the browser's.
- **The FTP service code was not changed.** Matching on recording insert is a database trigger, wrapped so it can never block a recording from being saved.

---

## 6. The flows, step by step

### 6.1 A lead arrives
1. A new row lands in the Google Sheet (from Meta).
2. **`LeadSync.gs`** (Apps Script, not deployed yet) runs every minute on a time trigger. It takes
   a `LockService` lock, compares `getLastRow()` with the last synced row it stored, and exits
   immediately if nothing is new.
3. New rows go in **one** request to `POST /api/v1/crm/leads/ingest` with header `X-CRM-Secret`.
   - The server answers **503** if `CRM_INGEST_SECRET` is unset or shorter than 32 characters,
     **401** if the secret is wrong (compared in constant time).
4. For each row the server (`ingestRows` in `crm.service.ts`), in its own transaction:
   - phone → **phone10**; fewer than 10 digits → result `invalid`;
   - same `external_id` already seen (on a lead *or* a past re-enquiry) → `duplicate` (idempotent: re-sending never duplicates);
   - same phone10 as an existing lead → **re-enquiry**: no new lead; the existing one gets a
     history entry, the tag `re-enquired`, and goes back to **New** (unless it is already Converted);
   - otherwise → a new lead `LMS-…` with status `new`.
5. The script writes `synced <time> (created LMS-…)` or `error: …` into a **"CRM Sync"** column,
   pings Healthchecks.io, and emails errors at most once per error per hour.
6. Nightly at 00:15, `reconcileYesterday()` sends yesterday's row IDs to
   `POST /crm/leads/reconcile`, re-sends any the server is missing, and emails the result.
7. In the demo, the **"Simulate new lead"** button (dev only) calls the same ingest code with a fake `90000 1xxxx` number.

### 6.2 The Lead Queue (every rep)
`/dashboard/crm`, data from `GET /crm/queue`, refreshed every 30 s.
- Only active leads (`new`, `retry`, `callback`). Sections, in this order
  (`lib/crm/queue.ts`):
  1. **Due now** — callback within 15 min either side of its time; the row **pulses gold**
     (static highlight + "Due now" pill if the user prefers reduced motion);
  2. **Overdue callbacks** — oldest first;
  3. **New** — never called, newest first;
  4. **Retry** — retries whose wait has passed, longest waiting first;
  5. **Later** — everything else (collapsed).
- Header tiles: due now, overdue, new today, converted today, my calls today.
- Tabs: **Shared queue** (everyone sees everything) · **My leads** (leads assigned to me, with a
  count) · **All leads** (searchable, sortable list).
- Each row: name, code, number grouped for dialling (`94656 58112`), source, code chip, tries,
  last contacted, next follow-up ("Callback set by Neha · for Priya · student asked for 6:30 PM"),
  badges ("★ Mine", "→ Neha", "🔒 Neha" when someone has it open), and a ▶ button to play the last recording.

### 6.3 Opening a lead: the lock
Clicking a row opens the **lead form** (a right-side drawer).
- After 300 ms the browser calls `POST /crm/leads/:id/lock`. The server sets `locked_by = me`,
  `locked_until = now + 5 min` — but only if nobody else holds a live lock.
- If someone else holds it, the form opens **read-only** with "Ritika Gill is on this lead".
- While the drawer is open, the lock is renewed every 60 s **if** the rep moved the mouse or
  typed in the last 2 minutes. Idle → it expires after 5 min so others can take the lead.
- Closing the drawer (or saving) releases it (`DELETE …/lock`, sent with `keepalive` so it goes
  out even if the tab closes).
- The 300 ms delay exists because React (in dev) mounts components twice; without it, the
  release from the throw-away mount could arrive after the real claim and free the lock.

**Opening does not assign the lead.** The lock is temporary; assignment is separate (6.8).

### 6.4 Filling the form
The "Lead follow-up" sheet (`components/crm/LeadDrawer.tsx`):

**Header:** name, code chip, status, Lead ID, received time, source/campaign; the number in
large type with **Copy** and **WhatsApp** buttons; WATI pill (green "WATI connected" when
credentials are set, amber "WATI mock mode" now).

**Lead assignment box** (owner / `reassign_leads` only): currently assigned to (greyed
"Shared pool" if nobody), previously assigned to, and "Assign this lead to" + Assign button.

**Call & follow-up card:**
1. **Student answers** — the owner-managed questions (default: Has a guitar?, Age group, Prior
   experience, Preferred class time). Saved as `[{question_id, label, value}]` with the label
   copied in, so editing a question later never changes old answers.
2. **Outcome** — the client's codes, letters fixed:

   | Code | Meaning | What happens on save |
   |---|---|---|
   | **A** | Didn't connect / switched off / not reachable | Retry later (default wait 6 h) |
   | **B** | Rang, not picked | Retry later (default 3 h) |
   | **C** | Picked up and cut | Retry next day 10:00 IST |
   | **D** | Talked, "call me later" | **Callback date + time required**, reason + note (≥15 chars) required |
   | **E** | Interested, will pay later | Same as D |
   | **F** | Paid the ₹299 trial | Reason + note required; amount defaults to 299; lead = Converted; recording kept forever |
   | **Z** | Not interested, never call again | Lead closed (Do not call); recording kept forever |

3. **Reason** dropdown — filtered to the chosen code (owner-managed list).
4. **Next follow-up**:
   - **D/E:** quick buttons (*In 1 hour · Today 6 PM · Tomorrow 10 AM · Tomorrow 6 PM*) fill the
     date and time, or type them; **Representative (assigned to)** dropdown, pre-filled with the
     current assignee, else whoever handled the lead last ("handled before"), else "Me";
     **"Student asked for this time"** checkbox.
   - **A/B/C:** shows the **automatic** retry time from the retry rules, e.g. "back in Retry after 3 h".
     The 6th failed attempt (or reason "Invalid number") shows that the lead will be **Dropped**.
   - **F/Z:** "no follow-up needed".
5. **Notes** — quick-note chips (filtered by code) insert text and fill `{date}` / `{time}` from
   the picker; character counter.
6. **Save form** (always visible at the bottom of the card).

**WhatsApp card:** template dropdown, auto-filled variables, chat-bubble preview (Preview
on/off switch), Send (see 6.9).

**Right side:** Follow-up snapshot (status, next date/time, assigned to, callback set by,
attempts, last contacted), the **call-log timeline**, and the **follow-up banner** with an
animated siren: while filling D/E it previews "Neha Sharma will be reminded on 06 Nov at 7:30 PM";
otherwise it shows the saved callback, the retry time, or the lead's state.

### 6.5 What happens when "Save form" is pressed
Browser → `POST /crm/leads/:id/outcome` with `{version, code, reason, note, answers,
callback_at, student_set_time, amount, assigned_to}`. Server (`saveOutcome` in `crm.service.ts`),
in one database transaction:
1. **Validate** (`lib/crm/rules.ts`): D/E/F need a reason and a note of ≥15 characters; D/E need a
   callback time that isn't in the past and is ≤90 days away. Error → 400 with a readable message.
2. **Lock the lead row** and check:
   - **version** differs from what the form loaded → **409 "This lead was updated by Neha, reload"**
     (the form shows a Reload button; the rep's typing is kept);
   - someone else holds a live lock → **423 "Neha is on this lead"**.
3. **Work out the new state** (`nextState` in `rules.ts`) using the retry rules from Settings:
   status, next follow-up time, attempts count, amount.
4. **Insert the form** into `lead_interactions` (code, reason, note, answers, follow-up, and in
   `meta` the resulting status, assignee and previous assignee).
5. **Update the lead**: status, current code, follow-up, attempts, answers, `callback_set_by`
   (= the saver, for D/E), `assigned_to` (for D/E), `last_contacted_at`, `version + 1`,
   `updated_by`, and **release the lock**.
6. **Link the recording** (6.6) — inside a savepoint, so a failed link never fails the save.
7. Commit → the drawer closes, the queue refreshes, a toast says "LMS-… saved as D · Callback".

### 6.6 Matching forms to recordings (both directions)
Rule: **same phone10, same rep (`calls.employee_id`, as stamped by the FTP service at upload),
call start within ±30 minutes of the form save, and neither already linked.** Nearest in time wins.
Each recording links to at most one form (unique index).

- **Form saved after the recording arrived** → `linkNearestCall()` in the API links it during the save.
- **Recording arrives after the form** (the usual case — FTP uploads come later, even hours
  later) → the Postgres trigger **`crm_link_call()`** runs on every insert into `calls` and links
  the nearest unlinked form. The window is on the call's **start time**, so a recording that is
  uploaded 2 hours late still matches.
- **Clock corrections:** the existing `fixClockDrift.ts` script corrects `calls.called_at`
  after insert. The trigger also fires on `UPDATE OF called_at`, so a corrected call gets matched.
- **Safety:** the trigger catches every error, writes it to **`crm_match_errors`**, and lets the
  recording save normally. CRM Reports shows the error count.
- When a link is made for an **F or Z** form, the call gets `keep_audio = true`.
- No match → that history entry says **"No recording found"** (and it shows in Reports → Checks).

### 6.7 Retries, drops, callbacks
- A/B/C count as **failed attempts**; D/E/F/Z reset the count.
- Waits come from **Settings → Retry rules** (defaults A 6 h, B 3 h, C next day 10:00; marked
  *Pending client decision*).
- **6 failed attempts → Dropped.** Reason "Invalid number" → Dropped immediately. The owner (or
  `reassign_leads`) can **Revive** a dropped lead (back to Retry, attempts reset).
- A callback is **Due now** from 15 min before to 15 min after its time, for **every rep**; after that it is **Overdue**.

### 6.8 Shared pool and assignment
- **Default: shared pool.** Every lead is visible to every rep; whoever is free opens the next one.
- **Assignment** says who should make the next call (`leads.assigned_to`). It is set by:
  1. **Saving a D/E** — the "Representative" field (pre-filled as in 6.4);
  2. **The owner in All Leads** — filter "Unassigned only", tick leads, pick a rep, **Assign**
     (or **Unassign** to send back to the pool);
  3. **The owner inside the lead form** — the "Lead assignment" box.
- Assigning bumps the lead's version (so an open form elsewhere gets the reload message) and adds
  a history entry "Assigned to Priya Nair by Kavita Malhotra" that also records who had it before
  (shown as "Previously assigned to").
- Reps see their leads under **My leads**; everyone still sees them in the shared queue.
- **Callback set by** ≠ **Assigned to**: Ritika may agree a 6:30 PM callback with the student,
  then the owner assigns the call to Priya.

### 6.9 WhatsApp templates (WATI)
- Three seeded templates (Trial details, Fee reminder, Class link) with variables `{name}`,
  `{amount}`, `{date}`, `{time}`, `{payment_link}`, `{class_link}`, filled from the lead.
- `wati.service.ts`: **mock mode whenever `WATI_API_URL` or `WATI_TOKEN` is unset** — it only
  logs `[wati:mock]` and never touches the network. Live mode calls WATI's `sendTemplateMessage`
  (written to their docs, never tested against a real account).
- Every send is a history entry: "WhatsApp: Trial details, sent by Neha".

### 6.10 History and audio
`GET /crm/leads/:id` returns the lead plus a merged **timeline**: every form, WhatsApp send,
re-enquiry and system note for the lead, and **every recording of that phone number by any rep**
(recordings not linked to a form show as "No form"). This is deliberately wider than the
existing `/calls/search`, which limits reps to their own calls; that endpoint was not changed.
- Audio uses the same URL logic as the rest of CallFlow (extracted into `services/audioUrls.ts`).
- Recordings older than 90 days whose audio retention deleted show **"Audio expired (90-day limit)"**.
- The player has a waveform-style seek bar, speed (1x / 1.5x / 2x) and download.
- The owner can **★ star** a recording to keep it forever (`keep_audio`).
- Timeline dots glow for contacted entries; the latest pulses.

### 6.11 CRM Reports (owner or `view_crm_reports`)
`/dashboard/crm/reports`, period picker (Today by default), tabs:
- **Overview** — tiles (forms saved, *Likely conversations (≥30 s, coded D/E/F/Z)*, paid trials,
  conversion = paid ÷ forms, "Needs checking" count); outcome-mix donut; lead funnel (worked →
  connected → talked → interested → paid, distinct leads); highlights (top closer, most
  conversations, busiest hour, top reason for "no"); forms per hour; per-rep stacked outcome bars.
- **Team** — a card per rep with a conversion ring and outcome bar; full number table on demand.
- **Reasons** — donuts for Z reasons and D/E reasons with the most common one called out.
- **Checks** — everything to review:
  - *Forms with no recording* (no matching KoreCall call yet);
  - *Recordings with no form* (only for numbers that are leads, after the lead existed);
  - *Probable number typos* (an unlinked form and an unlinked call by the same rep within 30 min
    whose numbers differ by one digit or one adjacent swap — "Link these?", never automatic; "Preview, v2");
  - *Code vs call check* (e.g. D saved but the call check heard "busy");
  - *Matching errors* from the trigger.
- **Paid digest** — preview of the daily email.

"Dials" = recordings of lead numbers. "Likely conversations" = forms coded D/E/F/Z whose
matched recording is ≥30 s (see section 3 for why).

### 6.12 Daily paid (F) digest email
- One email per day to the owner(s) listing every F: lead, rep, time, matched-call duration, a
  link to the lead in the dashboard (`/dashboard/crm?lead=<id>`, never a raw audio link), and a
  red **"No recording"** flag where no call matched.
- Send time is a setting (default 21:00 IST); recipients default to all owners.
- Same scheduler pattern as the existing reports: a 60-second tick, the row in
  `crm_digest_runs` is the send lock (no double sends), up to 3 attempts. Production + `CRM_ENABLED` only; locally use the preview.

### 6.13 Permissions and settings
Per-rep flags (table `employee_permissions`), checked **from the database on every request**
(the login token is unchanged), owner implicitly has all:

| Permission | Unlocks |
|---|---|
| `manage_questions` | Settings → Questions |
| `manage_templates` | Settings → Reasons and Note templates |
| `reassign_leads` | Assign / unassign, Lead assignment box, Revive |
| `export_leads` | All Leads page + CSV export |
| `view_crm_reports` | CRM Reports |

**CRM Settings** (`/dashboard/crm/settings`): questions, reasons, note templates (add / edit /
**deactivate — never delete**), retry rules, digest time + recipients, call-check mode, WATI
status, and the **Team permissions** matrix (owner). Items still to be confirmed by the client
carry a dashed **"Pending client decision"** tag.

### 6.14 Retention change (separate commit)
`retention.ts` (nightly R2 cleanup) now skips calls with `keep_audio = true` in **both** of its
delete passes and never clears their links. The selection logic was moved into a pure function,
`planDeletions()` in `lib/retentionPlan.ts`, with a test proving it gives **exactly the old result
when no call is kept** (50 randomised buckets). It reads `keep_audio` through `to_jsonb`, so it
works before the CRM migration has added the column. It was tested, never run against R2.

### 6.15 Short-call check (pending client decision)
Table `call_checks(call_id, label, confidence, source)`, kept separate so it can be dropped.
The prototype holds **seeded sample labels only** (no Deepgram calls). Labels show as chips in
the history and feed the "Code vs call check" list. Settings: Preview data only / Off.

---

## 7. Database: tables and columns added

Migrations `apps/api/src/db/migrations/011_crm_1_core.sql`, `011_crm_2_calls.sql`,
`011_crm_3_call_checks.sql` — all re-runnable (`IF NOT EXISTS` everywhere, because the existing
`migrate.ts` skips the rest of a file after an "already exists" error).

| Table | Purpose / key columns |
|---|---|
| `leads` | `lead_code` (LMS-…), `name`, `email`, `phone_raw`, `phone10` (unique), `source`, `campaign`, `external_id` (unique), `status` (new/retry/callback/converted/dnc/dropped), `current_code`, `next_followup_at`, `callback_set_by`, `student_set_time`, `attempts`, `last_contacted_at`, `amount`, `answers` (json), `raw` (json), `tags`, `locked_by`, `locked_until`, `version`, `updated_by`, `assigned_to` |
| `lead_interactions` | `lead_id`, `employee_id`, `kind` (call_outcome / whatsapp / system / reenquiry), `code`, `reason`, `note`, `template_id`, `answers`, `next_followup_at`, `call_id` (unique when set), `meta` (json: status, assigned_to, previous, external_id, mock…) |
| `lead_questions` | owner-managed questions (`type` yesno/select/text, `options`, `active`) |
| `lead_reasons` | reasons with the `codes` they apply to |
| `note_templates` | quick-note chips with `{date}`/`{time}` and `codes` |
| `wati_templates` | WhatsApp template name, label, body |
| `employee_permissions` | (employee, permission) pairs |
| `crm_settings` | key → json: `retry_rules`, `digest`, `call_check`, `links` |
| `crm_digest_runs` | one row per digest day = send lock |
| `crm_match_errors` | errors caught by the matching trigger |
| `call_checks` | preview short-call labels |
| **`calls` (existing)** | **added** `phone10` (generated + stored + indexed), `lead_id`, `keep_audio`; **trigger** `crm_link_call` on insert and on `called_at` update |

Product defaults (questions, 19 reasons, 8 note templates, 3 WATI templates, settings) are
inserted by the migration only when the lists are empty, so owner edits survive re-runs.

---

## 8. API endpoints

All under `/api/v1/crm`, mounted only when `CRM_ENABLED=true`. Code: `apps/api/src/routes/crm.routes.ts`.

| Method & path | Who | What |
|---|---|---|
| `POST /leads/ingest` | `X-CRM-Secret` | Intake from the sheet (≤500 rows), per-row results |
| `POST /leads/reconcile` | `X-CRM-Secret` | Which of these external IDs the server doesn't have |
| `GET /me` | logged in | My permissions |
| `GET /config` | logged in | Questions, reasons, chips, WATI templates, retry rules, reps, WATI mode |
| `GET /queue` | logged in | Queue sections + KPIs (filters: q, status, code, campaign, date, assigned=me) |
| `GET /leads` | logged in | List with filters/sort/paging (incl. `assigned=none|<rep id>`) |
| `GET /leads/export.csv` | `export_leads` | CSV (spreadsheet-formula-safe) |
| `POST /leads/assign` | `reassign_leads` | Bulk assign / unassign |
| `GET /leads/:id` | logged in | Lead, timeline, assignment history, WhatsApp variables |
| `POST /leads/:id/lock`, `DELETE /leads/:id/lock` | logged in | Claim / extend / release the soft lock |
| `POST /leads/:id/outcome` | logged in | Save the form (6.5) |
| `POST /leads/:id/revive` | `reassign_leads` | Dropped → Retry |
| `POST /leads/:id/whatsapp` | logged in | Send a template (mock or live), logged in history |
| `GET /calls/:id/audio` | logged in | Play a recording of a lead's number (queue ▶ button) |
| `POST /calls/:id/keep` | owner | Star / unstar a recording (`keep_audio`) |
| `GET /reports` | `view_crm_reports` | Everything CRM Reports shows |
| `POST /mismatches/link` | `view_crm_reports` | "Link these?" for a probable typo |
| `GET /digest/preview?date=` | `view_crm_reports` | F digest email HTML |
| `GET /settings` | logged in | Lists, values, team (owner) |
| `POST/PATCH /settings/questions[/:id]` | `manage_questions` | Add / edit / deactivate |
| `POST/PATCH /settings/reasons[/:id]`, `/settings/templates[/:id]` | `manage_templates` | Add / edit / deactivate |
| `PATCH /settings/values/:key` | owner | retry_rules, digest, call_check, links |
| `PUT /settings/team/:employeeId` | owner | Set a rep's permissions |
| `POST /dev/simulate-lead` | logged in, **non-production only** | Fake lead for the demo |

Errors come back as `{ error, message }` with status 400 / 403 / 404 / 409 / 423 / 503.

---

## 9. File-by-file map

**API (`apps/api/src/`)**
| File | Role |
|---|---|
| `crmDevEnv.ts` | Safety preload (section 4) |
| `lib/crm/localDb.ts` | "Is this DB local?" guard |
| `lib/crm/phone.ts` | `phone10()`, grouping, probable-typo check |
| `lib/crm/rules.ts` | Codes, permissions, form schema, validation, retry/next-state rules |
| `lib/crm/queue.ts` | Queue buckets and ordering |
| `lib/crm/logic.test.ts`, `lib/crm/db.test.ts` | Tests (section 12) |
| `lib/retentionPlan.ts` (+ `.test.ts`) | Pure retention selection with keep_audio |
| `middleware/requirePermission.ts` | Permission check from the DB per request |
| `services/crm.service.ts` | Lock, save, matching on save, history, queue, ingest, reconcile, assign, revive |
| `services/crmReports.service.ts` | Reports, typo pairs, link pair, F digest (data, HTML, send, scheduler) |
| `services/wati.service.ts` | WhatsApp mock/live |
| `services/audioUrls.ts` | Shared audio URL helper (also used by `/calls/:id` now) |
| `routes/crm.routes.ts` | All CRM endpoints |
| `seedCrm.ts` | Demo data relative to "now", marker-based wipe, ffmpeg tone audio |
| `db/migrations/011_crm_*.sql` | Schema + trigger |
| **Changed:** `index.ts` (mount behind flag, digest scheduler), `retention.ts` (planDeletions), `routes/calls.routes.ts` (uses `audioUrlsFor`, same behaviour), `package.json` (`crm:*` scripts) |

**Web (`apps/web/`)**
| File | Role |
|---|---|
| `app/dashboard/crm/page.tsx` | Lead Queue (Shared queue / My leads / All leads) |
| `app/dashboard/crm/leads/page.tsx` | All Leads: filters, sort, CSV, bulk assign |
| `app/dashboard/crm/reports/page.tsx` | CRM Reports tabs |
| `app/dashboard/crm/settings/page.tsx` | CRM Settings |
| `components/crm/LeadDrawer.tsx` | The lead form: header, assignment box, call & follow-up, WhatsApp |
| `components/crm/History.tsx` | Snapshot, call-log timeline + player, siren follow-up banner |
| `components/crm/LeadTable.tsx` | Lead rows (queue + All Leads), inline play, checkboxes |
| `components/crm/kit.tsx` | CRM UI pieces built on the report palette (chips, tiles, header band, drawer, blink CSS) |
| `components/crm/icons.tsx` | Small line icons |
| `lib/crm.ts` | Flag, codes, labels, types, formatting |
| `hooks/useCrmMe.ts` | Current user's CRM permissions |
| **Changed:** `components/layout/Sidebar.tsx` (CRM section), `Topbar.tsx` (CRM titles), `middleware.ts` (hide CRM when flag off), `lib/api.ts` (added `put`) |

**Other:** `scripts/apps-script/LeadSync.gs` + README · `docs/crm-prototype/README.md`
(run + go-live notes) · `docs/crm-prototype/demo-walkthrough.mjs` (Playwright demo script) ·
`docs/crm-prototype/screenshots/` (18 screenshots) · `.gitignore` (ignores `apps/api/dev-uploads/`).

Style: everything reuses the Reports palette (`R` in `components/report/kit.tsx`: beige page,
cream cards, espresso header bands, gold accents) and DM Sans. Inline styles like the rest of the app; no new CSS framework.

---

## 10. Commits on the branch
`feature/crm-prototype`, oldest first (60 files, ~5,000 lines added):

| Commit | What |
|---|---|
| `23abc6b` | Local-only dev scripts with the production guard |
| `63ce8fb` | Retention refactor: `planDeletions()` skipping `keep_audio` (own commit, own test) |
| `b55072f` | Migrations: CRM tables, `calls.phone10`, matching trigger, call checks |
| `5f87fd7` | API: queue, lock/version, matching, intake, reports, seed, tests |
| `70a2181` | Lead Queue and first lead drawer (behind the web flag) |
| `f557c5f` | CRM Reports and All Leads pages |
| `1f6f9d9` | CRM Settings |
| `4c0d502` | Docs, walkthrough, screenshots, Apps Script |
| `4590af2` | One-screen lead form modelled on the client's mock |
| `84be666` | Assignee field, follow-up presets, siren banner, glowing timeline, WATI pill |
| `1d3d574` | CRM Reports redesign: tabs and charts, Checks tab |
| `0e450b0` | Bulk assign in All Leads, My leads tab |
| `79c443f` | Owner "Lead assignment" box in the lead form |

---

## 11. Running the demo

```bash
source ~/Downloads/callflow/.crm-venv/activate.sh   # every new terminal
pg_ctl status || pg_ctl -l $CRM_VENV/postgres.log -o "-p 5433 -k /tmp -c listen_addresses=127.0.0.1" start

cd ~/Downloads/callflow/CallFlow/apps/api
npm run crm:reset-demo      # fresh demo data relative to now (re-run right before a demo)
npm run crm:dev             # API on :4000, prints "database host: 127.0.0.1"

cd ../web && npx next dev   # http://localhost:3000
```
Logins (password **`Demo@1234`**): owner `owner@crm-demo.local` (Kavita Malhotra); reps
`neha@`, `priya@` (can view CRM reports), `ritika@`, `anjali@`, `sneha@`, `pooja@`, `simran@`
— all `@crm-demo.local`. Neha can manage reasons/templates.

**Demo flow:** Ritika → blinking "Due now" callback set by Neha → open it (history from Priya and
Neha with audio) → second browser as Anjali opens it → read-only lock → Ritika picks D, reason,
preset time, chip, Save form → "Simulate new lead" → open it, send WhatsApp (mock), mark F →
owner: CRM Reports (Overview, Checks, Reasons, Paid digest), Settings, All Leads → assign 3
leads to Ritika → Ritika's My leads.

The due-now callback is seeded 10 minutes ahead of the reset; it becomes Overdue ~25 min later.
Full clean-checkout setup: `docs/crm-prototype/README.md`.

---

## 12. Tests
`npm run crm:test` (API) — 14 tests, all passing; DB tests refuse non-local databases:
- phone10 normalisation (`09465658112`, `+91 94656 58112`, `919465658112`, empty, `Unknown`);
- probable typo detection;
- queue ordering (and the 15-minute edge);
- D/E/F validation; retry / drop / F amount rules;
- lock + 409 version conflict naming the editor;
- matching: form after recording; recording arriving 2 h late; call `called_at` corrected by 2 h;
- trigger errors are logged and never block a recording;
- ingest idempotency, re-enquiry, reconcile;
- assign / unassign / previous assignee / stale version / bad rep;
- retention: identical to the old logic without keep_audio; keep_audio protected in both passes.

Plus: the 17 tests that existed before still pass; API and FTP service build; web `type-check` adds no
errors (4 old ones in `overview/page.tsx` are not from this work); the Playwright walkthrough
plays the whole demo and saves 18 screenshots.

---

## 13. Assumptions, pending decisions, limits

**Assumptions made:** due-now window ±15 min; lock 5 min with a 60 s activity heartbeat;
failed attempts = A/B/C, 6th drops, "Invalid number" drops at once; matching ±30 min on call
start, same rep; re-enquiry reopens unless Converted; Z needs no reason; funnel and "likely
conversation" definitions as in 6.11; CRM types live in `apps/web/lib/crm.ts`.

**Pending client decisions** (tagged in Settings): retry rules; short-call auto-check
(Deepgram cost); WATI templates/credentials; contact directory (leads vs the existing
`students` table — left untouched); whether reps should be able to edit a lead's name/number.

**Not in the prototype (by spec):** Call Now / click-to-dial; push notifications to a single
rep (instead callbacks blink for everyone, and assignment names the rep).

**Limits:** Apps Script written but never run; WATI live mode untested; digest scheduler only
runs in production; queue sections capped at 200 rows (search narrows); laptop/tablet layouts
only; the "Source" text in the demo is invented — real campaign names come from the sheet's
`campaign_name` column via the script's `COLUMNS` mapping.

---

## 14. Going to production
1. **Back up**, then run the three `011_crm_*.sql` migrations on Supabase. **`011_crm_2_calls.sql`
   adds the generated `phone10` column, which rewrites the whole `calls` table and locks it while
   it runs** (FTP inserts and dashboard reads wait) — run it **after calling hours**.
2. API env: `CRM_ENABLED=true`, `CRM_INGEST_SECRET` (32+ chars), later `WATI_API_URL` + `WATI_TOKEN`.
3. Web build with `NEXT_PUBLIC_CRM_ENABLED=true` (it's baked in at build time).
4. Retention: deployable before or after the migration; do one dry run and compare counts.
5. Never run `seedCrm.ts` on production (it refuses anyway).
6. Install the Apps Script per `scripts/apps-script/README.md` (set `LAST_SYNCED_ROW` first).
7. Settle the pending client decisions.
8. Push the branch and merge only when ready; `main` is untouched.

---

## 15. Good questions to ask Claude about this
- "Walk me through what happens, second by second, when Ritika opens a lead, picks D and saves."
- "How does a recording that arrives 2 hours later still find its form?"
- "What exactly stops two reps calling the same student at the same time?"
- "What's the difference between Assigned to, Callback set by, and the lock?"
- "Why can't my laptop accidentally change the live database?"
- "What does each tab in CRM Reports measure, and what should I act on in Checks?"
- "What has to happen, in order, to put this live — and what could go wrong?"
- "Which parts are only mock/demo and need real credentials or client answers?"
