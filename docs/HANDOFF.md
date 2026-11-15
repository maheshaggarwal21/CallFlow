# CallFlow handoff: what is built, the rules, and what is still open

**Read this first in a new session.** Written 15 Nov 2026, after the Nov 12–15 revamp. Everything below is
**committed, pushed to `main` and live** on https://callflow.maxmusicschool.co.in (last deploy `73e9357`).
Deeper detail on pay: `docs/salary-commission/CURRENT-STATE.md`. Architecture and commands: `CLAUDE.md`.

---

## 1. How to work with this user (learned the hard way)

- **Never make a page look emptier after a change.** If a change hides data the client saw before, the
  user reads it as data loss. Removing the Lines tab once made the Intercoms page look blank (prod had no
  intercom↔line links) and caused real trouble. Show existing DB data; say clearly when something is empty
  in the database rather than in the code.
- **Small, exact changes; don't redesign what wasn't asked.** When the user says "leave it", leave it
  (e.g. intercom/line assignment is now the client's job on the Intercoms page; don't touch it).
- Answer in **simple terms** with a table when comparing things. Short sentences. The user relays to the client.
- **Commit, push and deploy after each change** (the user expects it live). Commit to
  `feature/access-salary`, fast-forward `main`, push both. Attribution line:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Before deploying UI, **check it in a headless browser** at 1280 and 1440/1600 px (no sideways scroll,
  no JS errors). Run `npm run crm:e2e` (96 checks) and the unit tests (27).
- **Screenshots:** paths under `/var/folders/.../TemporaryItems/NSIRD_screencaptureui_*` are usually
  unreadable or already gone. Ask the user to send the `~/Desktop/Screenshot …png` path instead.
- Long pasted commands wrap in the user's terminal: give short commands or a script file.
- **Auto mode blocks Claude from writing to the prod database** (and from writing server secrets). Read-only
  prod queries over ssh work. For a prod write, put it in `~/Downloads/callflow/deploy-crm/<name>.sh` and ask
  the user to run `! bash ~/Downloads/callflow/deploy-crm/<name>.sh`.
- **Saved passwords (client decision, 15 Nov 2026: "internal system, they forget"):** login still uses the
  bcrypt hash (`password_hash`). Next to it is `password_enc`, an AES-256-GCM copy (`lib/passwordVault.ts`, key
  `PASSWORD_VIEW_KEY` in the server's `.env` only; set up on prod with `deploy-crm/enable-password-view.sh`). The
  Super Admin sees it with "Show saved password" on the Users form (`GET /employees/:id/password`, owner only,
  Users and Admins, plus each Super Admin's OWN only (never another Super Admin's), `Cache-Control: no-store`, deliberately NOT logged). Passwords
  set before this shipped have no copy: type a new one and Save. Without the key nothing is stored (and a changed
  password clears any old copy), login is unaffected. Chosen over plain text so a copy of the database or a
  backup alone shows no password. If the key is lost the copies are unreadable; people just get new passwords.
- Keep secrets out of chat, logs and the browser: the payments key (`PAYMENTS_API_KEY`) and WATI token
  live only in `apps/api/.env` (local, git-ignored) and the droplet's `.env`. The user's email is private.

## 2. Production and deploying

- Droplet `root@159.65.158.155`, repo at `/root/CallFlow`, pm2 apps `api-server`, `web`, `ftp-receiver`
  (**never touch FTP**). DB = Supabase (Tokyo pooler). Web served from `/var/www/callflow`.
- **Deploy (what was used every time):**
  ```
  cd apps/web && rm -rf .next && NEXT_PUBLIC_API_BASE_URL=/api/v1 NEXT_PUBLIC_CRM_ENABLED=true npx next build
  # check: grep -rl "localhost:4000" .next/static  → must be empty
  D=~/Downloads/callflow/deploy-crm/web && rm -rf $D && cp -R .next/standalone $D \
    && mkdir -p $D/apps/web/.next && cp -R .next/static $D/apps/web/.next/static && cp -R public $D/apps/web/public
  bash ~/Downloads/callflow/deploy-crm/deploy-update.sh [NNN_new_migration.sql …]
  ```
  `deploy-update.sh`: pg_dump backup → `git pull` on the droplet → build API → run only the migrations named
  → restart → rsync web → checks (login page 200, API 401 without login). Prints the rollback dump/folder.
  A Google-font download sometimes fails the build: just retry.
- GitHub Actions deploy (`.github/workflows/deploy.yml`) exists but **has never run**: the repo owner
  (`maheshaggarwal21`) must enable Actions and make `kritgun-1907` an admin, then run `deploy-crm/setup-ci.sh`.
- Helper scripts in `~/Downloads/callflow/deploy-crm/` (outside the repo): `deploy-update.sh`,
  `enable-payments.sh`, `enable-wati.sh`, `activate-account.sh`, `setup-ci.sh`, `link-intercoms.sh`
  (**not to be run**: the client assigns intercoms themselves).

## 3. Local development

- The user's other project (ecommerce) uses ports **3000 and 4000**. Run CallFlow on **4010 / 3010**:
  - `.env.crm-dev` forces `PORT=4000`, so start the API with a second preload after `crmDevEnv`:
    `printf 'process.env.PORT="4010";process.env.WEB_ORIGIN="http://localhost:3010";' > /tmp/port4010.cjs`
    then in `apps/api`: `PAYMENTS_API_URL=http://127.0.0.1:4100 PAYMENTS_API_KEY=mock-key node -r ./dist/crmDevEnv.js -r /tmp/port4010.cjs dist/index.js`
  - Web: `NEXT_PUBLIC_API_BASE_URL=http://localhost:4010/api/v1 NEXT_PUBLIC_CRM_ENABLED=true npx next dev -p 3010`
- Local Postgres (port 5433) may be stopped: `source ~/Downloads/callflow/.crm-venv/activate.sh && pg_ctl -l $CRM_VENV/postgres.log -o "-p 5433 -k /tmp -c listen_addresses=127.0.0.1" start`
- `npm run crm:migrate` (local only), e2e: `node -r ./dist/crmDevEnv.js -r /tmp/port4010.cjs scripts/access-e2e.mjs`
  (it starts the mock payments server on :4100 itself). Unit: `npm run build && node --test dist/lib/*.test.js`.
- Login is rate-limited (20 / 15 min per IP); restarting the API resets it.
- `apps/api/.env` points at the **live** Supabase DB: never run plain `migrate.ts`.

## 4. What was built (Nov 12–15), by tab

| Tab | What it does now |
|---|---|
| **Users** | Switch toggle moves instantly (optimistic). Team picker has "+ Create team…" (popup: team name + office address; a Users-tab holder may list/create teams). One form per person: rank (Super Admin / Admin / User), ticked tabs, salary plan, extra commissions and deductions, line + intercom + calling number, daily targets, password. **Switched-off users sink to the bottom.** Switching someone off stores the day (`employees.left_on`). |
| **Intercoms** | The old **Lines tab was folded in here** (`/dashboard/lines` redirects). Each intercom: calling number, line, the person on that line, the line's calls today. The Edit popup has **Line** (numbers only), **Agent** (separate; "leave as it is" / "no one" / a person) and the phone number: picking a line does not pick its agent. The client assigns them. |
| **Teams** | Teams of reps by office/location (prod has none yet). |
| **Employee Tracker** (Super Admin) | Month dropdown (this + 11 before; **no All time**, by decision). **Includes the Owner (= Varinder Max on the school site) when linked**; owner accounts the school site doesn't know (system "WATI LINE") are left out. No "Top earner" tag on rows and no red "couldn't be read" banner (removed 15 Nov). Per person: trial and regular commission, extras, deductions, salary, total payout; eye opens their dashboard. **Someone switched off during the month** is listed for that month only, greyed at the bottom, "Left 15 Nov", salary pro-rated to the days worked, commission up to that day. |
| **My Dashboard** (`/dashboard/me`, every User's home) | Profile, salary plan, **targets box** (calling time, trial joining, regular joining), call stats, hourly chart, Pay · month card, fees table. The targets box shows **the day picked** in the dropdown (Today / Yesterday / one custom day); a longer period shows today. Calling time = the same total as the Talk time card (all calls, short ones too). |
| **Payments** | The school site's payments, **read only**. Opens on **every payment so far** (no dates sent); From / To optional; Clear dates; 50 per page; search; filters for mode, rep, fee type, **status**; Export CSV (all filtered rows). Columns: name + "linked to" label, contact (email, phone, copy buttons), amount, paid date, mode, rep, **Status** (between Representative and Fee type), fee type, receipt. Super Admin/Admin see everyone; a User sees only their own. (The "Not shown: …" banner was removed 15 Nov.) |
| **Codes** (was CRM Settings, then "CRM & Pay Settings"; `/dashboard/crm/settings`) | Lead status codes (A, B, C…) and, beside them, **payment status codes 1, 2, 3…** (name + colour). Every payment starts on 1. Only Admins / Super Admin change a payment's status. |
| **Reports** | Report view split by teams (falls back to one "Staff" list). Super Admins without a line are left out. |
| Removed | Overview, Team, Employees, Misc Calls, Settings (redirect to /dashboard); Students page is no longer in the menu. Login page has no demo credentials. |

**Migrations live in prod:** 016 access, 017 calls index, 018 teams, 019 extra deductions,
020 Lines→Intercoms permission move, 021 `payment_status`, 022 `employees.left_on` (earlier leavers
back-filled with their last call day), 023 `lines.freed_at` + frees lines of switched-off people,
024 `employees.password_enc`. Migrations are re-runnable and never edited after shipping.

## 4a. Line, intercom and agent rules (client, 15 Nov 2026; migration 023)

- **One person per line, one line per person, one intercom per line.** The recording's agent is stamped from
  `lines.employee_id` **when the recording arrives** (FTP ingest) and is never re-tagged by itself.
- **Switching a rep off frees their line** (no agent, `lines.freed_at` = now) **and takes their intercom off the
  line; the intercom keeps its calling number.** Switching back on does NOT re-attach anything. Migration 023
  also freed lines held by people already switched off (that was Jiya's line 01).
- **Dropdowns:** Intercoms popup: Line = lines with no other intercom; Agent = active people (any rank) who hold no
  other line. Users form: only free lines and intercoms (plus the user's own). The API enforces the same
  (409/400 with a readable message): `PATCH /lines/:id`, `saveUser`.
- **Calls on a free line have no agent** and count for nobody. `GET /lines` returns `gap_calls` (calls on the line
  with no agent since `freed_at`); the Intercoms page shows a warning, and the Intercoms popup has a checkbox
  "give them the N calls" (`PATCH /lines/:id` with `claim_gap`).
- **Swap agents:** `POST /lines/swap {a, b, with_intercoms}` (Intercoms tab button): the two lines trade agents in
  one step; optionally the two intercoms trade lines too. Past calls are not touched.

## 4b. Speed (15 Nov): the database is far from the server

The droplet is in **Bengaluru**, the Supabase DB in **Tokyo**: every query costs **~109 ms**, so a user save
(~8 queries) is ~1 s. Done in code: the per-request sign-in check is cached 10 s and cleared on any employee
save (`forgetAuthCache` in `middleware/auth.ts`); a save that changes only columns is one statement, no
transaction; permissions and line changes are one statement each; the status switch updates on screen first.
**The real fix is moving the DB to a Mumbai (ap-south-1) Supabase project** (~2–5 ms per query); that needs the
user's Supabase account and a dump/restore, so it is the user's call. Until then new code should keep the number
of queries per request small.

## 4c. WATI link

"Open in WATI" finds the chat with WATI's `getMessages/91<phone>` (its `conversationId`) and opens
`WATI_INBOX_URL/<conversationId>`. The contact id is NOT a conversation id (it gave "Conversation can't be
found"). A number that never chatted has no conversation: the inbox opens and the number is copied so the user
can press + (New chat).

## 5. Pay rules (code: `apps/api/src/lib/payroll.ts`, tests `payroll.test.ts`)

Confirmed by the client (14–15 Nov 2026):
- **Commission goes to the rep the payment is filed under** on the school site (by CallFlow ID).
- Fee type **"Trial"** → trial rate; **every other fee type → regular rate**. A **renewal earns the same
  rate** as the first regular fee, so each later monthly fee earns again (recurring).
- Rate type `pct` = % of the amount paid; `fix` = ₹ per payment. Money kept in paise, rounded at the end.
- **Fix salary is monthly.** Someone who left mid-month gets it **pro-rated** to the days worked (`proRated`).
  The old "Other amount" field was **removed on 15 Nov** (client: extra commission/deduction does that job; no
  prod user had a value; the DB column is left in place, unused).
- **Extra commission / deduction: paid once, in the month its start date falls in** (the form fills the start
  with the day it's added). Ranges are almost always inside one month.
- **% deduction = % of the fix salary** (of the pro-rated salary for a leaver).
- Payout never goes below ₹0.
- **Targets:** trial joining = Trial payments that day; regular joining = all other payments that day
  (renewals included); calling time = all calls' talk time that day.
- **Refunds are left out** (client: about one every two months; cover one with an Extra Deduction).

## 6. The school site's payments API

- `GET https://maxmusicschool.in/api/v1/partner/payments?callFlowId=<employees.id>[&startDate&endDate&page&limit]`,
  header `x-api-key`. Server-side only (`services/payments.service.ts`): zod-checked, https only, no
  redirects, 15 s timeout, 2-minute cache, up to 20 pages × 100 per rep, the key masked in logs.
- **It only answers per rep** (`callFlowId` required, no "all payments"), so CallFlow asks once per person
  and merges.
- Fields per payment: id, name, email, phone, amount(Paise), paidDate, paymentMode, feeType,
  representativeName, linkedTo (`student` / `request` / `incomplete` / `unlinked`; meaning not documented
  by them), receiptUrl (expires; Refresh gets a fresh one), createdAt/updatedAt. **No student id, no refund
  status.**
- **Linked today:** Jaspreet Kaur, Ramandeep Kaur, Shivani Jha, and **Owner = "Varinder Max"** (31 payments).
  Not linked: Jiya, Sandeep Kaur, Geeta Rani (all switched off), Kritgun, WATI LINE.
- The school site has **no payments before 18 Oct 2026** for the linked reps (checked directly against their
  API: the gap is their data, not CallFlow).
- The Owner is a Super Admin, so the **Employee Tracker does not work out his pay** (only Users and Admins).
  His payments do show on the Payments tab.

## 7. Production data facts (15 Nov 2026)

- Lines: 01 Jiya (switched off; **line 01 still records calls today under Jiya**, so someone else is using
  it), 02 WATI LINE, 03 Jaspreet, 04 Ramandeep, 06 Shivani; 05, 07–10 empty.
- Intercom calling numbers are the reps' own phones (compare `intercoms.phone_number` with `employees.phone`):
  601 = Shivani, 602 = Ramandeep, 603 = Jiya's number with one digit different (likely a typo), 606 matches
  nobody. The client is assigning intercoms on the Intercoms page.
- Ramandeep has a full plan (₹12,000, trial ₹30 fix, regular 2 %, target 6 h and 2 trials) and password
  reset on 14 Nov. Other reps' salaries/rates/targets may still be ₹0: check before reading pay as wrong.
- Switched off (with `left_on`): Geeta Rani and Sandeep Kaur 29 Sep, Jiya 14 Nov.

## 8. Open questions

**For the client**
1. Fee type **"Other"** (one ₹299 payment so far): trial rate, regular rate, or no commission? (Now: regular.)
2. **Payday**: is the pay month the 1st to the last day, and from what date is a month final?

**For the school's developer**
3. Payments **before 18 Oct** have no rep attached? Can they fill the rep in on older ones?
4. Jaspreet's name is spelled **"Japreet Kaur"** on their side (display only).
5. What does `linkedTo` mean exactly? Is there a sandbox URL? Rate limits? Please issue a **fresh API key**
   (the current one was pasted in chat).
6. Save CallFlow IDs for Jiya (`82285ca8-ef6f-434b-90ba-933c44d34c5d`) and Sandeep
   (`8a028915-36bf-4d2c-82e9-f0e8207f4a2b`) if they come back.
7. A **student id** on each payment would be needed only if the client later wants first-fee vs renewal
   rules or renewal credit to the converting rep.

**Waiting on the user's yes**
8. A "Mark month as paid" button that freezes a month's figures (today pay is recomputed live from the
   school site, so a later edit there changes a paid month).
9. Whether the Payments tab should also list people who left within the dates picked (now: active only).
10. Mobile layout: every dashboard page is ~500 px wide on a 390 px phone (sidebar has no mobile mode).

**Housekeeping**
11. Rotate the WATI token (pasted in chat); one real WhatsApp test send to the user's own number.
12. Reassign line 01 (Jiya is switched off but calls still come in on it).
13. 8 old lint errors in unrelated files; `/verify` misdetects this repo, so run the checks by hand.
