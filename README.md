# CallFlow

**Call-recording management system for Max Music School.**

CallFlow ingests call recordings produced by a KoreCall PBX, parses and stores them, and exposes an owner/employee web dashboard for searching, reviewing, and analysing calls. Recordings arrive over FTP, are parsed and attributed to a line/employee/student, uploaded to object storage, and indexed in PostgreSQL. A Next.js dashboard then lets staff filter recordings, play audio, review resolutions, and view per-team and per-employee analytics.

---

## Table of contents

- [System overview](#system-overview)
- [Architecture & data flow](#architecture--data-flow)
- [Technology stack](#technology-stack)
- [Monorepo layout](#monorepo-layout)
- [Prerequisites](#prerequisites)
- [Environment variables](#environment-variables)
- [Getting started (local development)](#getting-started-local-development)
- [Database](#database)
- [Recording ingestion pipeline](#recording-ingestion-pipeline)
- [Authentication & authorization](#authentication--authorization)
- [Object storage](#object-storage)
- [REST API reference](#rest-api-reference)
- [Web dashboard](#web-dashboard)
- [Shared types](#shared-types)
- [Production builds & deployment](#production-builds--deployment)
- [Build gotchas & conventions](#build-gotchas--conventions)
- [Removed features](#removed-features)
- [Reference documents](#reference-documents)

---

## System overview

CallFlow is composed of three runnable applications plus one shared library, each installed and run independently (there is **no root `package.json` and no npm workspaces**):

| App | Role |
|-----|------|
| **`apps/api`** | Express + TypeScript REST API. Serves the dashboard, handles auth/RBAC, and issues presigned audio URLs. |
| **`apps/ftp-service`** | A standalone FTP **server** that receives `.wav` uploads from the PBX, parses them, uploads audio to storage, and inserts call rows. |
| **`apps/web`** | Next.js 15 (App Router) dashboard for owners and employees. |
| **`packages/shared-types`** | Shared TypeScript types consumed by the web app as `@callflow/shared-types`. |

The API and FTP service both talk to the **same PostgreSQL database** and the **same Cloudflare R2 bucket** (accessed via the AWS S3 SDK).

---

## Architecture & data flow

```
                       ┌──────────────────────┐
                       │   KoreCall PBX        │
                       │  (uploads .wav over   │
                       │   FTP as calls end)   │
                       └──────────┬───────────┘
                                  │  FTP STOR (.wav)
                                  ▼
                       ┌──────────────────────┐
                       │   ftp-service        │
                       │  • ftp-srv server    │
                       │  • parse filename    │
                       │  • read duration     │
                       │  • upload to R2      │
                       │  • INSERT into calls │
                       └─────┬────────────┬───┘
                             │            │
                 audio .wav  │            │  call metadata
                             ▼            ▼
                   ┌──────────────┐  ┌──────────────────┐
                   │ Cloudflare   │  │  PostgreSQL      │
                   │ R2 (S3 API)  │  │  (calls, lines,  │
                   │              │  │  employees, …)   │
                   └──────┬───────┘  └────────┬─────────┘
                          │                   │
             presigned    │                   │  SQL (pg pool)
             GET URL       │                   ▼
                          │          ┌──────────────────┐
                          └────────► │   api (Express)  │
                                     │  • auth / RBAC   │
                                     │  • /api/v1/*     │
                                     │  • presign audio │
                                     └────────┬─────────┘
                                              │  JSON over HTTPS
                                              │  (cookie auth)
                                              ▼
                                     ┌──────────────────┐
                                     │   web (Next.js)  │
                                     │  dashboard UI    │
                                     └──────────────────┘
```

**End-to-end flow:** the PBX finishes a call → uploads a `.wav` to the FTP service → the service parses the filename, reads the audio duration, uploads the file to R2, and inserts a `calls` row (joined to `students` by phone and `lines` by line number for attribution) → the web dashboard queries the API → the API returns call metadata and, on demand, a short-lived presigned audio URL that the browser streams directly from R2.

---

## Technology stack

- **Language:** TypeScript across all apps.
- **API:** Node.js, Express 4, `pg` (raw parameterized SQL — no ORM), `zod` (validation), `jsonwebtoken`, `bcryptjs`, `express-rate-limit`, `multer` (CSV upload), `csv-parse`.
- **FTP service:** `ftp-srv` (FTP server), `music-metadata` (duration), `ffmpeg` (system binary, compression), `pg`, AWS S3 SDK.
- **Storage:** Cloudflare R2 via `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` (`region: "auto"`, `forcePathStyle: true`). Local `dev-uploads/` fallback when R2 is unconfigured.
- **Database:** PostgreSQL (external; the `.env.example` points at a Supabase instance).
- **Web:** Next.js 15 (App Router), React 18, SWR (data fetching/caching), inline-style design system.
- **Dev tooling:** `ts-node-dev` (API + FTP watch mode), `tsc` (builds and the web type gate).

---

## Monorepo layout

```
callflow/
├── apps/
│   ├── api/                      # Express REST API
│   │   ├── src/
│   │   │   ├── index.ts          # app bootstrap: CORS, rate limit, route mounting
│   │   │   ├── migrate.ts        # applies db/migrations/*.sql in order (idempotent)
│   │   │   ├── seed.ts           # seeds admin/employee users, lines, intercoms
│   │   │   ├── db/
│   │   │   │   ├── pool.ts        # single shared pg Pool (DATABASE_URL)
│   │   │   │   └── migrations/    # 001…006 .sql schema files
│   │   │   ├── middleware/
│   │   │   │   ├── auth.ts        # requireAuth (JWT from cookie or Bearer)
│   │   │   │   └── requireOwner.ts# owner-only guard
│   │   │   ├── routes/
│   │   │   │   ├── auth.routes.ts
│   │   │   │   ├── calls.routes.ts
│   │   │   │   ├── analytics.routes.ts
│   │   │   │   ├── employees.routes.ts
│   │   │   │   ├── lines.routes.ts
│   │   │   │   ├── intercoms.routes.ts
│   │   │   │   ├── students.routes.ts
│   │   │   │   ├── system.routes.ts
│   │   │   │   ├── dev.routes.ts       # dev-only, NODE_ENV !== production
│   │   │   │   └── devices.routes.ts   # present but NOT mounted (kept for reference)
│   │   │   ├── services/
│   │   │   │   ├── storage.service.ts     # R2 presign/upload/download + local fallback
│   │   │   │   └── studentLookup.service.ts
│   │   │   └── types/express.d.ts         # augments Express Request with `user`
│   │   └── dev-uploads/          # local audio store used when R2 is unconfigured
│   │
│   ├── ftp-service/              # FTP receiver + ingest
│   │   └── src/
│   │       ├── index.ts          # bootstraps the FTP server
│   │       ├── ftpServer.ts      # ftp-srv, STOR handler, ingest pipeline
│   │       ├── filenameParser.ts # KoreCall filename → structured metadata
│   │       ├── db/pool.ts        # pg Pool (same DATABASE_URL)
│   │       └── services/storage.ts# R2 upload (no local fallback here)
│   │
│   └── web/                      # Next.js dashboard
│       ├── app/
│       │   ├── page.tsx          # public landing
│       │   ├── login/            # login page
│       │   └── dashboard/        # authenticated app
│       │       ├── layout.tsx    # sidebar + topbar shell
│       │       ├── overview/     # owner dashboard (analytics)
│       │       ├── recordings/   # call search / play / detail drawer
│       │       ├── misc/         # short/misc calls
│       │       ├── employees/    # owner: employee list + [id] detail
│       │       ├── lines/        # owner: line ↔ employee assignment
│       │       ├── intercoms/    # owner: intercom management
│       │       ├── team/         # owner: team management
│       │       └── students/     # owner: student directory + CSV import
│       ├── components/           # calls/, employees/, layout/, modals/, ui/
│       ├── hooks/                # useAuth, useSystemStatus
│       ├── lib/                  # api.ts (fetch wrapper), colors, datetime, …
│       └── middleware.ts         # edge auth + role-based redirects
│
├── packages/
│   └── shared-types/             # @callflow/shared-types (built to dist/)
│
├── .env.example                  # templates for every app's env (dummy values)
├── CLAUDE.md                     # agent/contributor guide (current reality)
├── CALLFLOW_PLAN_V6.md           # authoritative feature/spec/schema plan
└── README.md                     # this file
```

> `apps/mobile/` has been removed. Some files may remain git-tracked but are deleted from the working tree — do not build on it.

---

## Prerequisites

- **Node.js 20+** and npm.
- **PostgreSQL** database (local or hosted; the example targets Supabase). There is **no docker-compose** — Postgres is external.
- *(Optional)* A **Cloudflare R2** bucket + credentials for real audio storage. Without it, the API falls back to a local `dev-uploads/` directory.

---

## Environment variables

Each app reads its own `.env` from its own directory (via `dotenv`). Templates live in the root **`.env.example`** (dummy values only). Copy the relevant section into the app's env file.

### `apps/api/.env`

| Variable | Required | Description |
|----------|----------|-------------|
| `NODE_ENV` | no | `development` (default) or `production`. In non-production the dev routes and `/dev-audio` static mount are enabled. |
| `PORT` | no | API port (default `4000`). |
| `DATABASE_URL` | **yes** | PostgreSQL connection string (shared with the FTP service). |
| `JWT_SECRET` | **yes** | Secret used to sign/verify JWTs. Auth fails closed (HTTP 500) if unset. Use a long, random value (≥32 chars recommended). |
| `WEB_ORIGIN` | recommended | Comma-separated CORS allowlist (e.g. `http://localhost:3000`). Requests with no `Origin` (curl/server-to-server) are allowed. |
| `R2_ENDPOINT` | no | R2 S3 endpoint. Leave as a placeholder to use the local `dev-uploads/` fallback. |
| `R2_BUCKET` | no | R2 bucket name. |
| `R2_ACCESS_KEY_ID` | no | R2 access key. |
| `R2_SECRET_ACCESS_KEY` | no | R2 secret key. |
| `COOKIE_DOMAIN` | no | Optional cookie domain for cross-subdomain auth in production. |

### `apps/web/.env.local`

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_API_BASE_URL` | **yes** | Base URL the browser uses to reach the API (default `http://localhost:4000/api/v1`). |

### `apps/ftp-service/.env`

| Variable | Required | Description |
|----------|----------|-------------|
| `FTP_USER` | **yes** | Username the PBX authenticates with. |
| `FTP_PASSWORD` | **yes** | Password the PBX authenticates with. |
| `FTP_SERVER_PORT` | no | FTP control port (default `21`). |
| `FFMPEG_PATH` | no | Path to the ffmpeg binary (default `ffmpeg` on `PATH`). Without ffmpeg, recordings are stored as uncompressed WAV. |
| `VPS_PUBLIC_IP` | **yes in production** | Public IP advertised for passive-mode data connections. Passive FTP breaks without the correct public IP. |
| `DATABASE_URL` | **yes** | PostgreSQL connection string (same DB as the API). |
| `R2_ENDPOINT` / `R2_BUCKET` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | recommended | R2 credentials for audio upload. **Note:** the FTP service uploads to R2 only — if R2 is unconfigured, `audio_storage_key` is stored as `NULL` (no local fallback on this side). |

> **Security:** env files are gitignored (`.env`, `.env.*`, `**/.env*`), while `.env.example` is intentionally tracked. Keep real credentials out of `.env.example`.

---

## Getting started (local development)

Install dependencies **separately** in each app/package directory (no workspaces).

### 1. Shared types (build first)

The web app resolves `@callflow/shared-types` from its compiled `dist/`, so build it before running or building the web app.

```bash
cd packages/shared-types
npm install
npm run build
```

### 2. API

```bash
cd apps/api
npm install
# create apps/api/.env from the .env.example "apps/api/.env" section
npm run dev        # ts-node-dev, watch mode, http://localhost:4000
```

Run migrations and seed against a fresh database (plain scripts — no dedicated npm script):

```bash
# from apps/api/
npx ts-node-dev src/migrate.ts   # applies db/migrations/*.sql in filename order (idempotent)
npx ts-node-dev src/seed.ts      # seeds admin + employee users, lines 01–10, intercoms 601–610
```

`migrate.ts` swallows "already exists" errors, so it is safe to re-run. **Do not run `seed.ts` against a populated production database** — it upserts demo users and reference rows.

### 3. Web dashboard

```bash
cd apps/web
npm install
# create apps/web/.env.local with NEXT_PUBLIC_API_BASE_URL
npm run dev        # next dev, http://localhost:3000
```

### 4. FTP service (optional locally)

```bash
cd apps/ftp-service
npm install
# ffmpeg is required for compression (Ubuntu: sudo apt install ffmpeg; macOS: brew install ffmpeg)
# create apps/ftp-service/.env
npm run dev        # starts the FTP server
```

### Default seeded credentials

`seed.ts` upserts two accounts:

| Role | Email | Password |
|------|-------|----------|
| Owner | `admin@maxmusic.in` | `Admin@1234` |
| Employee | `employee@maxmusic.in` | `Employee@1234` |

---

## Database

Schema is defined by plain SQL files in `apps/api/src/db/migrations/`, applied in filename order by `migrate.ts`.

### Core tables

| Table | Purpose |
|-------|---------|
| `employees` | Users (owners and employees). Holds `password_hash`, `role`, `status`, `color_index` (UI avatar colour). |
| `lines` | PBX line numbers (`01`–`10`), each optionally assigned to an employee with a `purpose`. Ingestion attributes a call's employee via its line. |
| `intercoms` | Intercom codes (`601`–`610`) with an optional `phone_number`. Kept for a possible future return; not present in current filenames. |
| `devices` | Legacy table kept for FK integrity. No devices API is mounted. |
| `calls` | The central record: source, line, direction, caller phone, student name, `called_at`, duration, employee, `is_misc`, `resolution_status`, `audio_storage_key`, `source_file_key` (unique — dedup key). |
| `students` | Student directory (name, unique `phone`, notes). Joined by phone during ingestion to attribute a caller to a student. |
| `system_state` | Single-row table (`id = 1`) holding `ftp_last_sync_at` (drives the dashboard "FTP sync active" indicator) and `audio_format` (`mp3` \| `opus`, owner-selected compression for new recordings). |

### `calls` — key columns

| Column | Notes |
|--------|-------|
| `source` | `'korecall'` (or historical `'android_app'`; the CHECK constraint is intentionally retained). |
| `source_file_key` | Unique. Ingestion uses `ON CONFLICT DO NOTHING` on this to dedup re-delivered files. |
| `line_number` / `intercom_code` | Attribution keys. |
| `call_direction` | `'inbound'` \| `'outbound'`. |
| `caller_phone` | Digits (or `'Unknown'` when unparseable). |
| `student_name` | Snapshotted at ingest from `students`. |
| `called_at` | Timestamptz; parsed from the filename timestamp pinned to IST (+05:30). |
| `duration_secs` | Read from the audio via `music-metadata`. |
| `is_misc` / `misc_reason` | Calls under 10s are flagged `is_misc`. |
| `resolution_status` | `'resolved'` \| `'escalated'` \| `'no_response'` \| `NULL`. |
| `audio_storage_key` | Object key in R2 (or local `dev-uploads` basename). Never returned to the client directly — the API turns it into a presigned URL. |

### Migration history

| File | Change |
|------|--------|
| `001_initial.sql` | Core tables (`employees`, `lines`, `intercoms`, `devices`, `calls`) + indexes. |
| `002_students.sql` | `students` table + phone index. |
| `003_ai_jobs_system_state.sql` | (Historical) `ai_jobs` queue table + `system_state` singleton. |
| `004_no_response.sql` | Adds `'no_response'` to the `resolution_status` CHECK; back-fills misc calls. |
| `005_remove_ai.sql` | Drops `ai_jobs`, `call_segments`, and the `summary`/`transcript_*`/`sentiment`/`ai_status` columns from `calls`. |
| `006_remove_android.sql` | Drops `system_state.android_last_sync_at`. |
| `007_audio_format.sql` | Adds `system_state.audio_format` (`mp3` default, or `opus`). |

---

## Recording ingestion pipeline

The FTP service **runs** an FTP server (`ftp-srv`); it does not poll a remote one. Temp files are written under the OS tmpdir (`korecall_ftp/`).

On each `STOR` (upload-complete) event for a `.wav`:

1. **Dedup check** — skip if a `calls` row already exists for the `source_file_key`.
2. **Parse the filename** (`filenameParser.ts`).
3. **Read duration** with `music-metadata`. Calls `< 10s` are flagged `is_misc` (reason: "Short duration — possible disconnect") and given `resolution_status = 'no_response'`.
4. **Compress** with ffmpeg to the owner-selected `system_state.audio_format` — MP3 or Opus/WebM, both 16 kbps mono (~25% of the WAV). The output's duration must match the WAV (±2s); on any failure (no ffmpeg, bad input, mismatch) the original WAV is uploaded instead.
5. **Upload audio to R2** under key `korecall/<sourceKey>` with the extension swapped to `.mp3` / `.webm` (or the original `.wav` on fallback). If upload fails / R2 is unconfigured, `audio_storage_key` is `NULL`.
6. **Attribute** the call — look up `student_name` by caller phone and `employee_id` by line number.
7. **Insert** the `calls` row with `ON CONFLICT (source_file_key) DO NOTHING`.
8. **Stamp** `system_state.ftp_last_sync_at = NOW()`.
9. **Always** `unlink` the temp WAV and compressed file in a `finally` block.

Filenames that don't fully match still insert a best-effort row via `partialParse` (line + direction inferred from the leading digits and A/B marker; `caller_phone = 'Unknown'`).

### KoreCall filename format

```
{LL}--{A|B}-{phone}---{YYYYMMDDHHmmss}-{tail}.wav
```

- `{LL}` — two-digit line number.
- `{A|B}` — direction marker: **A → inbound**, **B → outbound**.
- `{phone}` — digits only, variable length.
- `{YYYYMMDDHHmmss}` — 14-digit local (IST) timestamp, parsed with a pinned `+05:30` offset so UTC servers don't shift the stored instant.
- Intercom code is **no longer present** in filenames (the `intercom_code` column and filter are retained for a possible future return).

Example: `03--B-09465658112---20250524112115-Unknown.wav` → line `03`, outbound, phone `09465658112`, 2025-05-24 11:21:15 IST.

---

## Authentication & authorization

- **Login** issues a JWT signed with `JWT_SECRET` (`8h` expiry) and sets it as an **httpOnly `token` cookie**. In production the cookie is `secure` + `sameSite=none`; in development `sameSite=lax`.
- **Token transport:** the API accepts the JWT from the `token` cookie **or** an `Authorization: Bearer <token>` header (`middleware/auth.ts`).
- **Payload:** `{ sub, role, name, color_index }`, where `sub` is the employee id.
- **Roles:**
  - **`owner`** — sees all calls and analytics; can manage employees, lines, intercoms, students.
  - **`employee`** — scoped to their own calls (queries filter `calls.employee_id = req.user.sub`).
- **Guards:** `requireAuth` protects all data routes; `requireOwner` gates owner-only routes. Role scoping is otherwise applied inline in queries.
- **Web edge middleware** (`apps/web/middleware.ts`) decodes the JWT at the edge and redirects: unauthenticated users to `/login`, and employees away from owner-only paths (an employee hitting `/dashboard/employees` is redirected to their own `/dashboard/employees/<id>`).
- **Rate limiting:** global limiter of 200 req/min per IP; login limited to 20 attempts / 15 min. `trust proxy` is enabled for correct keying behind nginx.

---

## Object storage

Audio is stored in **Cloudflare R2**, accessed through the **AWS S3 SDK** (so "S3" in the code means R2). `region` is `"auto"` and `forcePathStyle` is `true`.

- **Delivery:** the browser never receives a raw object key. `GET /api/v1/calls/:id` resolves `audio_storage_key` to a **presigned GET URL** (15-minute expiry) and returns it as `audio_presigned_url`.
- **Local fallback (API only):** `isR2Configured()` checks the endpoint/key at runtime. When R2 is unconfigured, the API stores/serves audio from `apps/api/dev-uploads/` and returns a `/dev-audio/<file>` URL (a static mount enabled only when `NODE_ENV !== "production"`). If no local file exists, `audio_presigned_url` is `null` and the player shows "Audio not available".
- **FTP-side storage** (`ftp-service/src/services/storage.ts`) is **upload-only to R2**, with no local fallback.

---

## REST API reference

**Base path:** `/api/v1`. All responses are JSON. Auth is via the `token` cookie or `Authorization: Bearer`. Unless noted, endpoints require authentication.

### Conventions

- **401** — missing/invalid token (or `JWT_SECRET` unset → **500** "Server misconfigured").
- **403** — authenticated but not permitted (e.g. employee accessing another employee's data, or a non-owner hitting an owner route).
- **400** — request body/query fails `zod` validation.
- **404** — resource not found. **409** — unique-constraint conflict (duplicate email/phone).

### Auth — `/auth`

| Method | Path | Auth | Body / Query | Response |
|--------|------|------|--------------|----------|
| `POST` | `/auth/login` | public (rate-limited 20/15min) | `{ email, password }` (password 8–72 chars) | `{ user: { id, name, email, role, color_index } }` + sets `token` cookie. `401` on bad credentials. |
| `POST` | `/auth/logout` | public | — | `{ ok: true }` + clears cookie. |
| `GET` | `/auth/me` | required | — | `{ id, name, email, role, color_index }`. |

### Calls — `/calls`

| Method | Path | Auth | Parameters | Response |
|--------|------|------|------------|----------|
| `GET` | `/calls` | required | Query: `phone`, `date_from`, `date_to`, `line`, `direction`, `intercom`, `is_misc` (`true`/`false`), `employee_id` (owner only), `limit` (≤200, default 50/25), `offset`. Employees are auto-scoped to their own calls. | `{ data: Call[], total, limit, offset }`. Phone is matched digits-only via `LIKE`. |
| `GET` | `/calls/:id` | required | — | A single `Call` plus `audio_presigned_url`. Employees may only fetch their own calls (`403` otherwise). |
| `POST` | `/calls/search` | required | `{ phone (≥3), limit?, offset? }` | `{ calls: Call[], total, found }`. Phone normalized to the last 10 digits. |
| `PATCH` | `/calls/:id/resolution` | required | `{ resolution_status: "resolved" \| "escalated" \| null }` | `{ id, resolution_status }`. Ownership enforced for employees. |

### Analytics — `/analytics`

| Method | Path | Auth | Parameters | Response |
|--------|------|------|------------|----------|
| `GET` | `/analytics/misc-count` | required | — | `{ count, avg_duration_secs, disconnected_count, no_response_count }`. |
| `GET` | `/analytics/overview` | **owner** | Query: either `date_from` + `date_to` (**custom range** — disables month-over-month deltas) **or** `month` (`YYYY-MM`; defaults to current month). | `OverviewStats`: totals, `mom_delta`, `direction_split`, `team_split`, `weekly_activity`, resolution counts, `top_line`, `line_status`, `recent_calls`. |
| `GET` | `/analytics/employee/:id` | owner **or** self | Query: `date_from`, `date_to`. | `EmployeeAnalytics`: totals + 7-day `daily_breakdown`. |

### Employees — `/employees`

| Method | Path | Auth | Parameters | Response |
|--------|------|------|------------|----------|
| `GET` | `/employees/names` | required | — | Active employees: `[{ id, name, color_index }]`. |
| `GET` | `/employees` | **owner** | — | Employees with aggregated `call_stats` (total/inbound/outbound/avg duration). |
| `GET` | `/employees/:id` | owner **or** self | — | `{ id, name, email, phone, role, status, color_index }`. |
| `POST` | `/employees` | **owner** | `{ name, email, phone?, role?, password (8–72) }` | `201` created employee. `409` if email exists. Auto-assigns the next `color_index`. |
| `PATCH` | `/employees/:id` | **owner** | `{ name?, email?, phone?, status?, password? }` | Updated employee. `409` on email conflict. |

### Lines — `/lines`

| Method | Path | Auth | Parameters | Response |
|--------|------|------|------------|----------|
| `GET` | `/lines` | required | — | All lines with assigned employee (name + colour) and `call_count_today`. |
| `PATCH` | `/lines/:id` | **owner** | `{ employee_id? (uuid\|null), purpose? }` | Updated line. Setting `employee_id` also stamps/clears `assigned_at`. |

### Intercoms — `/intercoms`

| Method | Path | Auth | Parameters | Response |
|--------|------|------|------------|----------|
| `GET` | `/intercoms` | required | — | All intercoms with `call_count_total`. |
| `PATCH` | `/intercoms/:id` | **owner** | `{ phone_number: string\|null }` | Updated intercom; stamps/clears `assigned_at`. |

### Students — `/students` (all endpoints require **owner**)

| Method | Path | Parameters | Response |
|--------|------|------------|----------|
| `GET` | `/students` | — | All students, newest first. |
| `POST` | `/students/import` | `multipart/form-data` with `file` (CSV; columns `name`, `phone`, `notes`) | `{ imported, skipped, errors[] }`. Phones normalized to digits (10–13 length); duplicates skipped via `ON CONFLICT (phone)`. Runs in a transaction. |
| `PATCH` | `/students/:id` | `{ name?, phone?, notes? }` | Updated student. `409` on duplicate phone. |
| `DELETE` | `/students/:id` | — | `{ id }`. |

### System — `/system`

| Method | Path | Auth | Response |
|--------|------|------|----------|
| `GET` | `/system/status` | required | `{ ftp_last_sync_at }` — drives the dashboard sync indicator. |
| `GET` | `/system/settings` | owner | `{ audio_format }` — compression format for new recordings. |
| `PATCH` | `/system/settings` | owner | Body `{ audio_format: "mp3" \| "opus" }`. Returns `{ audio_format }`. Applies to recordings uploaded afterwards. |

### Dev — `/dev` (only when `NODE_ENV !== "production"`)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/dev/test-call` | Inserts a synthetic call pointing at a local `.wav` (`{ audio_file_path, caller_phone?, call_direction?, duration_secs?, employee_email? }`) — useful for exercising audio playback without the FTP path. |
| `GET` | `/dev/status` | Dev-routes health check. |

Additionally, a static mount **`/dev-audio/*`** serves `dev-uploads/` in non-production for local audio playback.

> `devices.routes.ts` exists on disk but is **not mounted** — there is no devices API. The `devices` table is retained only for FK integrity.

---

## Web dashboard

Next.js 15 App Router under `apps/web/app/`.

### Routes

| Path | Access | Purpose |
|------|--------|---------|
| `/` | public | Marketing landing page. |
| `/login` | public | Sign-in (email/password). |
| `/dashboard/recordings` | any user | Search, filter, play, and open call detail (employees see only their own). |
| `/dashboard/misc` | any user | Short/misc calls view. |
| `/dashboard/overview` | owner | Analytics dashboard (stat cards, direction/team splits, line status, recent calls). |
| `/dashboard/employees` + `/[id]` | owner (employees redirected to their own detail) | Employee list and per-employee analytics. |
| `/dashboard/lines` | owner | Assign lines to employees. |
| `/dashboard/intercoms` | owner | Manage intercom phone numbers. |
| `/dashboard/team` | owner | Team management. |
| `/dashboard/students` | owner | Student directory + CSV import. |

### Key components & conventions

- **Data layer:** every API call goes through **`lib/api.ts`** (`api.get/post/patch/delete/postForm` + the SWR `fetcher`). It always sends `credentials: "include"` and, on a `401` (except `/auth/login`), redirects to `/login`. Do not hand-roll `fetch` — extend this helper.
- **Recordings:** `components/calls/CallFilters` (phone, From/To dates, type, line, intercom, agent), `CallTable` (per-row inline play/pause that fetches a presigned URL on demand), and `CallPanel` — the `›` detail drawer. The drawer renders `components/ui/AudioPlayer`, a seekable player (play/pause, draggable progress scrubber, elapsed/total time) that restores per-call playback position from `sessionStorage`.
- **Dashboard date filter:** the overview period selector offers presets (Today, Yesterday, Last 7 Days, This Month, Last Month, All Time) plus a **Custom Range** option that reveals From/To date pickers, driving `date_from`/`date_to` on `/analytics/overview`.
- **Hooks:** `useAuth` (current user/role) and `useSystemStatus` (FTP sync indicator).
- **Navigation:** `components/layout/Sidebar` renders role-aware sections; owners additionally see Analytics and Management groups.

---

## Shared types

`packages/shared-types` exports the TypeScript contracts shared between the API and the web app (`AuthUser`, `Employee`, `Call`, `Line`, `Intercom`, `Student`, `OverviewStats`, `EmployeeAnalytics`, `Paginated<T>`, etc.). The web app imports it as `@callflow/shared-types` via a `file:` link and resolves it from the package's compiled `dist/`, so it **must be built** before building or running web (`npm run build` in `packages/shared-types`).

---

## Production builds & deployment

Each app builds and runs independently:

```bash
# shared-types (always first)
cd packages/shared-types && npm install && npm run build

# api
cd apps/api && npm install && npm run build && npm run start      # node dist/index.js

# web
cd apps/web && npm install && npm run build && npm run start      # next start

# ftp-service
cd apps/ftp-service && npm install && npm run build && npm run start
```

Production notes:
- Set `NODE_ENV=production` for the API to disable dev routes and the `/dev-audio` mount.
- Set `WEB_ORIGIN` to the deployed dashboard origin(s) for CORS.
- Set `VPS_PUBLIC_IP` for the FTP service — passive-mode FTP will not work without the correct public IP.
- Configure real `R2_*` credentials so audio is served from R2 via presigned URLs.

---

## Build gotchas & conventions

- **Build `shared-types` before web.** Web resolves `@callflow/shared-types` from `dist/`; a stale or missing build breaks the import.
- **`apps/web/next.config.mjs` sets `ignoreBuildErrors` and `ignoreDuringBuilds`.** `next build` passes even with TypeScript/ESLint errors, so **`npm run type-check` (`tsc --noEmit`) is the real type gate** for the web app — always run it to validate types.
- **No test suite** exists in any app.
- **No ORM** — queries are parameterized raw SQL in the route files against a single shared `pg` pool.
- **Migrations/seed are plain scripts** (run with `ts-node-dev` or the compiled `dist/`); there is no dedicated npm script for them.

---

## Removed features

- **AI/transcription** — the AI queue, worker, prompts, Bull, Redis, and `ai.service.ts` were removed. Migration `005_remove_ai.sql` dropped the `ai_jobs`/`call_segments` tables and the `summary`/`transcript_*`/`sentiment`/`ai_status` columns. Do not reintroduce AI code unless explicitly requested.
- **Android/mobile app** — removed. Migration `006_remove_android.sql` dropped `system_state.android_last_sync_at`; the devices API is unmounted and the mobile-specific web UI is gone. The `source` CHECK constraint on `calls` still permits historical `android_app` rows.

---

## Reference documents

- **`CLAUDE.md`** — concise contributor/agent guide reflecting current reality; the best short orientation to the codebase.
- **`CALLFLOW_PLAN_V6.md`** — authoritative feature/spec/bug list and full DB schema.
- **`context.md`** — working rules and project status.
- **`AGENTS.md`** — broader agent guide, but **partially stale** (still references the removed mobile app, the AI/Bull/Redis queue, AWS S3 naming, Next.js 14, and docker-compose). Prefer this README, `CLAUDE.md`, and the code for current reality.
