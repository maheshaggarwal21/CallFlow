# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

CallFlow is a call-recording management system for Max Music School. Recordings arrive over FTP from a KoreCall PBX, get parsed and stored, and an owner/employee web dashboard searches and reviews them.

## Monorepo layout (no workspaces)

There is **no root `package.json`** and **no npm workspaces**. Each app is installed, built, and run independently from its own directory.

- `apps/api/` — Express + TypeScript REST API (PostgreSQL + Cloudflare R2)
- `apps/ftp-service/` — standalone FTP **server** that receives and ingests recordings
- `apps/web/` — Next.js 15 (App Router) dashboard
- `packages/shared-types/` — shared TS types, consumed by web as `@callflow/shared-types` via `file:` link

> `apps/mobile/` is being removed: its files are still git-tracked but already deleted from the working tree. Do not build on it.

## Commands

Run `npm install` separately in each app/package directory.

**API** (`apps/api/`)
```
npm run dev      # ts-node-dev, watch mode (default port 4000)
npm run build    # tsc -> dist/
npm run start    # node dist/index.js
```
Migrations and seeding are plain scripts (no dedicated npm script): run `src/migrate.ts` and `src/seed.ts` with ts-node-dev (e.g. `npx ts-node-dev src/migrate.ts`) or via the compiled `dist/`. `migrate.ts` applies every `src/db/migrations/*.sql` in filename order and is idempotent (it swallows "already exists" errors), so re-running is safe.

**Web** (`apps/web/`)
```
npm run dev         # next dev, http://localhost:3000
npm run build       # next build
npm run type-check  # tsc --noEmit  <- the REAL type gate (see below)
npm run lint        # next lint
```

**FTP service** (`apps/ftp-service/`) and **shared-types** (`packages/shared-types/`) use the same `dev` / `build` / `start` pattern (`build` only for shared-types).

There is **no test suite** in any app. There is **no docker-compose** (older docs reference one that no longer exists); Postgres is external (the `.env.example` points at a Supabase instance).

### Two build gotchas
- **Build `packages/shared-types` before building/dev-ing web** — web resolves `@callflow/shared-types` from its `dist/`, so a stale or missing build breaks the import.
- **`apps/web/next.config.mjs` sets `ignoreBuildErrors` and `ignoreDuringBuilds`** — `next build` passes even with TypeScript/ESLint errors. Always run `npm run type-check` to actually validate web types; the production build won't catch them.

## Architecture

### API (`apps/api/src/`)
- `index.ts` mounts routes under `/api/v1/*` (auth, calls, analytics, employees, intercoms, lines, system, students). `dev.routes.ts` and a local `/dev-audio` static mount are enabled only when `NODE_ENV !== "production"`. Note: `devices.routes.ts` exists on disk but is **not mounted** — the devices table is kept for FK integrity but no devices API is exposed.
- **DB**: a single `pg` pool in `db/pool.ts`, shared by API and FTP service. Queries are parameterized inline in route files; there is no ORM.
- **Storage** (`services/storage.service.ts`): Cloudflare R2 accessed through the **AWS S3 SDK** (`region: "auto"`, `forcePathStyle: true`). `isR2Configured()` decides at runtime whether to use R2 or fall back to a local `dev-uploads/` directory served via `/dev-audio`. Audio is delivered to the browser as presigned URLs. So "S3" in code means R2.
- **CORS**: `WEB_ORIGIN` is a comma-separated allowlist; requests with no `Origin` (curl/server-to-server) are allowed. `trust proxy` is on for correct rate-limit keying behind nginx.

### Auth & RBAC
- JWT read from an httpOnly `token` cookie **or** an `Authorization: Bearer` header (`middleware/auth.ts`). Token payload: `{ sub, role, name, color_index }` where `sub` is the employee id.
- Two roles: **`owner`** (sees all calls) and **`employee`** (sees only their own). Routes apply `requireAuth`; role scoping is done **inline** in the query (employees filter `calls.employee_id = req.user.sub`). `middleware/requireOwner.ts` guards owner-only routes.

### FTP service (`apps/ftp-service/src/`)
This **runs** an FTP server (`ftp-srv`), it does not poll a remote one. On the `STOR` (upload-complete) event for each `.wav`: parse the filename (`filenameParser.ts`), read duration with `music-metadata`, upload to R2, then insert a row into `calls`. Dedup is enforced by the unique `source_file_key` (`ON CONFLICT DO NOTHING`); temp files in the OS tmpdir are always `unlink`ed in a `finally`. Calls under 10s are flagged `is_misc`. Filenames that don't fully parse still insert with best-effort line/direction via `partialParse`.

### Web (`apps/web/`)
- App Router under `app/` (`login/`, `dashboard/`), shared UI in `components/` (`calls`, `employees`, `layout`, `modals`, `ui`), `hooks/` (`useAuth`, `useSystemStatus`), helpers in `lib/`.
- **All API calls go through `lib/api.ts`** (`api.get/post/patch/delete/postForm` + SWR `fetcher`). It always sends `credentials: "include"` (cookie auth) and on a `401` (except `/auth/login`) redirects to `/login`. Don't hand-roll `fetch`; extend this helper.

### Database
Schema lives in `apps/api/src/db/migrations/*.sql`. Core tables: `employees`, `lines`, `intercoms`, `devices`, `calls`, `students`, `system_state`. The FTP ingest joins `students` (by phone) and `lines` (line → `employee_id`) to attribute each call.

> **AI features were removed.** Migration `005_remove_ai.sql` drops the `ai_jobs` and `call_segments` tables and the `summary`/`transcript_*`/`sentiment`/`ai_status` columns from `calls`. The AI queue/worker/prompts, Bull, Redis, and `ai.service.ts` are all gone — including the previously dangling `import { aiQueue }` in `ftpServer.ts`, which has been cleaned up. Do not add new AI/transcription code unless explicitly asked.

> **Android/mobile app removed.** Migration `006_remove_android.sql` drops `system_state.android_last_sync_at`. The `/api/v1/devices` route is unregistered (file kept for reference only). The source filter, API-key/QR modal, and `DeviceName` type are removed from the web app. The `source` CHECK constraint on `calls` is intentionally left intact to preserve historical `android_app` rows.

> **KoreCall filename format** (current): `{LL}--{A|B}-{phone}---{YYYYMMDDHHmmss}-Unknown.wav` — two-digit line, direction A/B, digits-only phone (variable length), timestamp after `---`. Intercom code is no longer present in filenames; the `intercom_code` column in DB and the intercom filter in the web app are kept for a possible future return.

## Key environment variables

Per-app `.env` files (templates in `.env.example`). The essentials:
- `DATABASE_URL` — Postgres (shared by API + FTP service)
- `JWT_SECRET` — min 32 chars; auth fails closed (500) if unset
- `R2_ENDPOINT` / `R2_BUCKET` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` — leave unset/placeholder to use the local `dev-uploads/` fallback
- `WEB_ORIGIN` — CORS allowlist (comma-separated) for the API
- `NEXT_PUBLIC_API_BASE_URL` — web → API base (default `http://localhost:4000/api/v1`)
- FTP: `FTP_USER` / `FTP_PASSWORD` / `FTP_SERVER_PORT` / `VPS_PUBLIC_IP` — **`VPS_PUBLIC_IP` is required in production**; passive-mode FTP breaks without the correct public IP.

## Reference docs

- `CALLFLOW_PLAN_V6.md` — authoritative feature/spec/bug list and full DB schema.
- `context.md` — working rules and project status.
- `AGENTS.md` — broader agent guide. **Partially stale**: it still describes the removed mobile app, the AI/Bull/Redis queue, AWS S3 (now R2), Next.js 14 (now 15), docker-compose, and links several files that no longer exist (`problems.md`, `implementation-plan.md`, `developer-a-checklist.md`, `call.jsx`). Prefer this CLAUDE.md and the code for current reality.
