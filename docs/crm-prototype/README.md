# CRM prototype (localhost demo)

Branch `feature/crm-prototype`. A lead follow-up CRM built into CallFlow: shared lead pool,
soft locks, outcome codes A–F/Z, callbacks that blink 15 min before they're due, full
cross-rep history with KoreCall recordings, WhatsApp templates (mock), owner reports.
Everything is behind `CRM_ENABLED` (API) and `NEXT_PUBLIC_CRM_ENABLED` (web).

**It cannot reach production while run as below:** every `crm:*` script preloads
`apps/api/src/crmDevEnv.ts`, which loads `apps/api/.env.crm-dev` *before* `apps/api/.env`,
blanks R2 / Resend / WATI / Deepgram, and exits unless the database host is
`localhost` / `127.0.0.1`. `seedCrm.ts` and `db.test.ts` check the host again themselves.

## Run the demo from a clean checkout (macOS)

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

# 3. Install, migrate, seed (ffmpeg on PATH makes the sample tone audio)
(cd ../../packages/shared-types && npm ci && npm run build)
npm ci && (cd ../web && npm ci)
npm run crm:migrate
npm run crm:seed            # same as crm:reset-demo; re-run before every demo

# 4. Start (two terminals)
npm run crm:dev             # API on :4000  (prints "database host: 127.0.0.1")
cd ../web && npx next dev   # web on :3000
```

Logins (password `Demo@1234`): reps `neha@ priya@ ritika@ anjali@ sneha@ pooja@ simran@crm-demo.local`,
owner `owner@crm-demo.local`. Neha has `manage_templates`, Priya has `view_crm_reports`.
Re-seed right before the demo: the "Due now" callback is seeded 10 minutes ahead of *now*.

**Demo flow:** log in as Ritika → blinking callback set by Neha → open it (history: Priya's
B, Neha's D with audio) → log in as Anjali in a second browser, open the same lead (read-only,
"Ritika Gill is on this lead") → Ritika picks D, reason, time, chip, Save → "Simulate new lead"
→ open it, send "Trial details" (mock), mark F → log in as owner → CRM Reports, CRM Settings.

Tests and walkthrough:
```bash
cd apps/api && npm run crm:test                  # 13 CRM + retention tests (DB tests are local-only)
cd apps/web && npm run type-check                # only the 4 pre-existing errors in overview/page.tsx
PLAYWRIGHT_MODULE=$CRM_VENV/pw/node_modules/playwright/index.mjs node docs/crm-prototype/demo-walkthrough.mjs
```
(Playwright is installed in `$CRM_VENV/pw` with `npm i playwright@1 && npx playwright install chromium`.)

## Screenshots
`docs/crm-prototype/screenshots/01-queue-due-now.png` … `11-pending-client-decisions.png`, one per demo step.

## Assumptions made
- "Due now" = from 15 min before the callback until 15 min after it; after that it is Overdue.
- Lock heartbeat every 60 s while the drawer is open and the rep moved or typed in the last 2 min;
  lock lasts 5 min. The first claim waits 300 ms so a mount React immediately undoes doesn't claim.
- "Failed attempts" = A/B/C saves; the 6th makes the lead Dropped; reason "Invalid number" drops at once.
  D/E/F/Z reset the count. Owner (or `reassign_leads`) can revive a Dropped lead.
- Matching window is ±30 min on the call's `called_at`, same rep via `calls.employee_id`.
- Re-enquiry reopens any lead to New except a Converted one (that only gets the tag + history entry).
- Z needs no reason (only D/E/F do); the Z reason report shows "(no reason)" for those.
- Likely conversations (≥30 s, coded D/E/F/Z) = forms with a talked code whose matched recording is ≥30 s.
- Code funnel stages: Worked → Connected (C–Z) → Talked (D–Z) → Interested (E/F) → Paid (F), distinct leads.
- Dials in CRM Reports = recordings of lead numbers. Recordings without a form only count calls made after the lead existed.
- CRM types live in `apps/web/lib/crm.ts`, not `packages/shared-types`, to keep the prototype self-contained.
- WATI live mode follows WATI's documented `sendTemplateMessage`; it has never run against a real account.

## Not done / limits
- No real WATI, Deepgram or Resend call was made (by design). Digest email only prints in dev.
- Apps Script is written, not deployed or run (no Google account in this environment).
- The F digest scheduler only runs in production with `CRM_ENABLED=true`; locally use the preview.
- Mobile layouts were not tuned (laptop 1280–1440 px and tablet are).
- The "Later" queue section and each list are capped at 200 rows; search narrows them.

## Going to production
1. **Migrations** (`011_crm_1_core.sql`, `011_crm_2_calls.sql`, `011_crm_3_call_checks.sql`) on Supabase.
   `011_crm_2_calls.sql` adds the **generated `phone10` column, which rewrites the whole `calls` table and
   holds an ACCESS EXCLUSIVE lock** while it runs: FTP inserts and dashboard reads wait. Run it **after
   calling hours**, and take a backup first. It also installs the matching trigger on `calls`.
2. **API env:** `CRM_ENABLED=true`, `CRM_INGEST_SECRET` (32+ chars; intake answers 503 otherwise),
   `WATI_API_URL` + `WATI_TOKEN` to leave mock mode (test one send to an internal number first).
   `RESEND_API_KEY` is already set for reports; the digest reuses it.
3. **Web build:** `NEXT_PUBLIC_CRM_ENABLED=true` at build time (it is inlined).
4. **Retention:** the `planDeletions()` refactor (own commit) is safe to deploy before or after the
   migration: `keep_audio` is read through `to_jsonb`, so it is simply false until the column exists.
   Run one dry run (`node dist/retention.js`) and compare its counts with the previous night's log.
5. **Seed only product defaults:** never run `seedCrm.ts` against production (it refuses anyway).
   Questions, reasons, note templates, WATI templates and settings come from the migration.
6. **Apps Script:** follow `scripts/apps-script/README.md`; set `LAST_SYNCED_ROW` before enabling.
7. Pending client decisions to settle first: retry rules, short-call auto-check (Deepgram cost),
   WATI templates, contact directory (leads vs students).
