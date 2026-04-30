# CallFlow — Complete Production Plan (V6)
### Max Music School · Call Recording Management System
**Version:** 6.0 (Third Deep Cross-Review Against call.jsx — Line by Line)
**Changes over V5:** 9 new bugs found and fixed (BUG-45 through BUG-53). Critical fixes to Team page quick stats API gap, Source filter param translation, Recordings Agent filter RBAC gap, missing `callSentiment.ts` and `Topbar.tsx` from folder structure, `eClr` array overflow crash, JWT cross-origin cookie strategy, missing design token constants file, and MiscPage stat card aggregation gap. All V3–V5 bugs remain fixed.

---

## TABLE OF CONTENTS

1. [Project Overview](#1-project-overview)
2. [V6 New Corrections Over V5](#2-v6-new-corrections-over-v5)
3. [Feature Inventory (Verified Against Design)](#3-feature-inventory)
4. [Architecture Overview](#4-architecture-overview)
5. [Tech Stack Decisions](#5-tech-stack-decisions)
6. [Repository & Folder Structure](#6-repository--folder-structure)
7. [Database Schema](#7-database-schema)
8. [API Specification — All Endpoints](#8-api-specification)
9. [Data Ingestion — KoreCall FTP Service](#9-korecall-ftp-ingestion-service)
10. [Data Ingestion — Android App](#10-android-app)
11. [AI Pipeline](#11-ai-pipeline)
12. [RBAC System](#12-rbac-system)
13. [Page-by-Page Frontend Breakdown](#13-page-by-page-frontend-breakdown)
14. [Security Checklist](#14-security)
15. [Environment Variables](#15-environment-variables)
16. [Team Division of Work](#16-team-division-of-work)
17. [Implementation Phases & Timeline](#17-phases--timeline)
18. [Master Bug Index — All Versions](#18-master-bug-index)

---

## 1. Project Overview

**CallFlow** is a call-management and analytics dashboard for Max Music School. It replaces the unreadable KoreCall folder structure (`REC202507/20250701/01--B----20250701123938-Unknown.wav`) with a searchable, AI-enriched web dashboard.

### Two Data Sources

| Source | When | How |
|--------|------|-----|
| **KoreCall PBX** | Business hours (~9 AM – 5 PM) | FTP pull → parse filename → write directly to DB + R2 |
| **Android Phone(s)** | After 5 PM / overflow | React Native app reads call logs + recordings → upload to API |

### Three Deliverables

1. **Web Dashboard** — Next.js 14 + Express + PostgreSQL. Owner sees everything; each employee sees only their own calls.
2. **FTP Ingestion Service** — Node.js daemon polling KoreCall FTP on a cron schedule, writing directly to the database.
3. **Android App** — React Native (Android-only). Minimal middleware: API key login → device setup → background sync every 15 minutes.

---

## 2. V6 New Corrections Over V5

All BUG-01 through BUG-44 remain fixed per V3–V5. The following are new findings from a complete line-by-line reading of every component in `call.jsx`, cross-referenced against V5's folder structure, API spec, and frontend breakdown sections.

---

### BUG-45 — Team Page Quick Stats Have No API Backing (**CRITICAL**)

**Problem:** In the design's `TeamPage`, every agent row in the roster shows four quick stats in the main row (before any expand): total calls (`cnt`), inbound (`inb`), outbound (`out`), and avg duration (`avgDur`). These are computed inline from the global `CALLS` mock array. They are visible in the main row on desktop — not just in the expanded section — which means they cannot be lazy-loaded on expand. The V5 `GET /api/v1/employees` response returns only identity fields (`id`, `name`, `email`, `phone`, `role`, `status`, `color_index`). There is no stats field. In production with thousands of calls, the frontend has no way to compute these per-employee totals, because call data is paginated and never returned in full. The Team page would render all four stat columns blank.

**Fix:** Add a `call_stats` object to every record returned by `GET /api/v1/employees`. This is computed server-side via a single SQL query with a subquery or LEFT JOIN aggregate — one database round trip for all employees, not N round trips. The response shape becomes:

```
Employee: {
  id, name, email, phone, role, status, color_index,
  call_stats: {
    total: number,
    inbound: number,
    outbound: number,
    avg_duration_secs: number
  }
}
```

The SQL to compute this as part of the employees query is:

```sql
SELECT
  e.*,
  COALESCE(s.total, 0)          AS stats_total,
  COALESCE(s.inbound, 0)        AS stats_inbound,
  COALESCE(s.outbound, 0)       AS stats_outbound,
  COALESCE(s.avg_dur, 0)        AS stats_avg_duration_secs
FROM employees e
LEFT JOIN (
  SELECT
    employee_id,
    COUNT(*)                                          AS total,
    COUNT(*) FILTER (WHERE call_direction='inbound')  AS inbound,
    COUNT(*) FILTER (WHERE call_direction='outbound') AS outbound,
    ROUND(AVG(duration_secs))                         AS avg_dur
  FROM calls
  WHERE is_misc = FALSE
  GROUP BY employee_id
) s ON s.employee_id = e.id
```

The Team page assembles stats directly from this response. The `EmpDashPage` and `EmployeePage` still use `GET /analytics/employee/:id` for date-filtered stats — the `call_stats` on the employees list is all-time and used only for the Team page roster.

---

### BUG-46 — Source Filter Mixes `source` Type and `device_id` UUID — Param Translation Not Documented (**MEDIUM**)

**Problem:** The Recordings page source filter dropdown has options built as: `{ label: 'KoreCall', val: 'korecall' }` for the FTP source and `{ label: d.device_name, val: d.id }` (a UUID) for each Android device. The `GET /api/v1/calls` endpoint accepts two separate query params: `source` (`korecall` or `android_app`) and `device_id` (a UUID). The V5 plan shows the dropdown values but never documents how `CallFilters.tsx` translates the selected value into the correct API parameter. A developer would likely pass `source={selectedVal}` for all cases, causing device UUIDs to land in the `source` param — an invalid enum — which would return zero results or a 400 error.

**Fix:** Document the translation explicitly in `CallFilters.tsx` with the following conditional logic when building the query object passed to `lib/api.ts`:

```typescript
// In CallFilters.tsx, when constructing params from sourceFilter state:
function buildSourceParams(sourceFilter: string): Partial<CallQueryParams> {
  if (sourceFilter === 'All') return {};
  if (sourceFilter === 'korecall') return { source: 'korecall' };
  // Otherwise it's a device UUID from the Android device list
  return { source: 'android_app', device_id: sourceFilter };
}
```

This function must be documented in `lib/api.ts` as part of the `CallQueryParams` type definition, and its usage in `CallFilters.tsx` must reference this function rather than any inline logic.

---

### BUG-47 — Recordings Page Agent Filter: `GET /api/v1/employees` Is Owner-Only But Recordings Is Accessible to Both Roles (**MEDIUM**)

**Problem:** The Recordings page agent filter dropdown is populated from `GET /api/v1/employees` per the V5 plan. This endpoint is Owner-only (RBAC). An employee accessing the Recordings page has no way to fetch the employee list and the Agent filter dropdown will be empty or throw a 403. The V5 plan lists the Agent filter as "dynamic from API" without specifying different behavior per role.

**Fix — Two-part solution:**

**Part 1 — New endpoint:** Add `GET /api/v1/employees/names` (accessible to **both roles**), returning only `[{ id: string, name: string, color_index: number }]` for active employees. This mirrors the pattern established by `GET /api/v1/devices/names` (BUG-09 fix). The endpoint exposes no sensitive data (no email, password hash, phone).

**Part 2 — Role-aware rendering in `CallFilters.tsx`:** For the employee role, the Agent filter is hidden entirely (since employees are auto-scoped to their own calls at the API level and the filter would be meaningless — they only ever see their own calls regardless of what agent filter they select). Only owners see the Agent filter dropdown.

```typescript
// In RecordingsPage / CallFilters.tsx:
// Owner: fetch GET /api/v1/employees/names, show Agent dropdown
// Employee: do not render the Agent dropdown at all
{role === 'owner' && (
  <DropBtn id="agent" ...>
    {['All', ...employees?.map(e => e.name) ?? []].map(...)}
  </DropBtn>
)}
```

This means employees see 5 filter pills (Date, Line, Type, IC, Source) and owners see 6 (same plus Agent).

---

### BUG-48 — `callSentiment.ts` Missing from Folder Structure in Section 6.2 (**LOW**)

**Problem:** The V5 folder structure lists `lib/` as containing `api.ts`, `chartTransforms.ts`, `tagMaps.ts`, and `colors.ts`. The `callSentiment.ts` file is described in detail in Section 11 (AI Pipeline) and Section 13 (Frontend Breakdown) and assigned to Developer B in Week 1 of Section 16. However it is absent from the `lib/` listing in Section 6.2. A developer building from the folder structure would not create this file during scaffolding and would encounter missing import errors in `CallRow.tsx` and `MobileCallCard.tsx` later.

**Fix:** Add `lib/callSentiment.ts` to the folder structure listing. The file imports design tokens from `lib/constants.ts` (see BUG-52) and exports one function: `callSentiment(call: Call): SentimentResult`.

---

### BUG-49 — `Topbar.tsx` Missing from Folder Structure in Section 6.2 (**LOW**)

**Problem:** The V5 folder structure lists `components/layout/` as containing only `Sidebar.tsx`. `Topbar.tsx` is referenced in the feature inventory (Section 3.1: "Topbar: breadcrumb, month label, LIVE indicator"), in the team division (Developer B, Week 1), and in phase descriptions, but is absent from the actual folder listing. It would not be created during scaffolding.

**Fix:** Add `components/layout/Topbar.tsx` to the folder structure. The Topbar is responsible for: breadcrumb display, current month/year label (computed dynamically with `new Date()` — not hardcoded as "July 2025" which is a design mock), and the LIVE indicator dot (driven by `useSystemStatus` hook).

---

### BUG-50 — `eClr(colorIndex)` Has No Modulo Guard — Crashes on 9th Employee (**LOW**)

**Problem:** The `lib/colors.ts` file implements `eClr(colorIndex)` to return a color scheme for an agent based on their `color_index`. The plan never specifies how many entries are in `AGENT_PALETTE`. If the palette has 8 entries (a reasonable design-matching set) and a 9th employee is added (`color_index = 8`), `AGENT_PALETTE[8]` returns `undefined`. Any component calling `eClr(e.color_index)` would crash with `Cannot read properties of undefined` — silent production failures in colors, borders, and text styling for that employee and all subsequent ones.

**Fix:** The `eClr` function must use the modulo operator to wrap around the palette:

```typescript
// lib/colors.ts
export const AGENT_PALETTE = [
  { t: C.orange, bg: C.orangeLight, br: C.orangeBdr },  // index 0
  { t: C.teal,   bg: C.tealLight,   br: C.tealBdr   },  // index 1
  { t: C.blue,   bg: C.blueLight,   br: C.blueBdr   },  // index 2
  { t: C.green,  bg: C.greenLight,  br: C.greenBdr  },  // index 3
  { t: C.red,    bg: C.redLight,    br: C.redBdr    },  // index 4
  // Add more entries as the design system expands
];

export const eClr = (colorIndex: number) =>
  AGENT_PALETTE[colorIndex % AGENT_PALETTE.length] ?? AGENT_PALETTE[0];
```

The `?? AGENT_PALETTE[0]` fallback is a safety net in case `colorIndex` is negative or NaN (should never happen, but defensive).

---

### BUG-51 — JWT Auth Strategy for Cross-Origin Next.js + Express Not Fully Specified (**MEDIUM**)

**Problem:** V5 states the JWT is stored in an "httpOnly cookie" but the `POST /auth/login` response body includes `token: string`. For a Next.js frontend on Vercel (e.g., `callflow.vercel.app`) calling a separate Express API on DigitalOcean (e.g., `api.maxmusic.in`), these are different origins. An httpOnly cookie set by the Express API for domain `api.maxmusic.in` will NOT be sent by the browser to `api.maxmusic.in` when the request originates from `callflow.vercel.app` unless `SameSite=None; Secure` is set. Additionally, the Next.js `fetch` calls must include `credentials: 'include'`. If this is not configured, the auth cookie is never sent on subsequent requests and every API call after login returns 401. V5 does not document any of this.

**Fix — Explicit auth contract:**

**Express API side (`apps/api/src/index.ts`):**
```typescript
app.use(cors({
  origin: process.env.WEB_ORIGIN,   // e.g. "https://callflow.vercel.app"
  credentials: true,                 // REQUIRED — allows cookies cross-origin
}));

// In POST /auth/login handler, after generating JWT:
res.cookie('token', jwt, {
  httpOnly: true,
  secure: true,
  sameSite: 'none',    // REQUIRED for cross-origin cookie sending
  maxAge: 8 * 60 * 60 * 1000,  // 8 hours in ms
});
res.json({ user: { id, name, email, role, color_index } });
// NOTE: token NOT returned in body for web — only in cookie
// Mobile API key endpoint (POST /mobile/auth/login) returns token in body
// because React Native does not use browser cookies
```

**Next.js frontend side (all `lib/api.ts` calls):**
```typescript
const apiFetch = (path: string, options?: RequestInit) =>
  fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL}${path}`, {
    ...options,
    credentials: 'include',   // REQUIRED — sends the httpOnly cookie cross-origin
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  });
```

**Add to env vars:** `apps/api/.env` must include `WEB_ORIGIN=https://callflow.vercel.app`.

**Mobile app** continues using the `Authorization: Bearer <token>` header approach (token returned in `POST /mobile/auth/login` response body and stored in Zustand + AsyncStorage).

---

### BUG-52 — Design Token Constants (`C` Object) Not Extracted — No `constants.ts` in Folder Structure (**MEDIUM**)

**Problem:** The `call.jsx` design file defines a `const C = { bg, bgDeep, orange, green, ... }` object at the top of the file. Multiple production utility files — `callSentiment.ts`, `tagMaps.ts`, `colors.ts` — reference these token values (e.g., `C.green`, `C.orange`, `C.red`). The V5 folder structure has no `constants.ts` or `tokens.ts` file anywhere. A developer implementing these utility files would either inline the hex values (creating drift if colors change) or import from `call.jsx` directly (nonsensical in a Next.js project). This is a shared dependency that affects at least four utility files and would be discovered only when someone tries to import and gets a module not found error.

**Fix:** Add `lib/constants.ts` to the folder structure and to the Week 1 task for Developer B. This file exports the full `C` design token object that matches `call.jsx` exactly:

```typescript
// lib/constants.ts
export const C = {
  bg:          "#f7f5f0",
  bgDeep:      "#f0ede6",
  card:        "#ffffff",
  cardWarm:    "#fffdf9",
  sidebar:     "#faf8f4",
  border:      "#e8e2d9",
  borderLight: "#f0ebe2",
  hover:       "#f5f2ec",
  text:        "#1a1714",
  textSub:     "#4a4540",
  muted:       "#8a8278",
  dim:         "#c4bdb4",
  orange:      "#e8761a",
  orangeLight: "rgba(232,118,26,0.10)",
  orangeBdr:   "rgba(232,118,26,0.22)",
  green:       "#2d7d4a",
  greenLight:  "rgba(45,125,74,0.10)",
  greenBdr:    "rgba(45,125,74,0.22)",
  blue:        "#2563a8",
  blueLight:   "rgba(37,99,168,0.10)",
  blueBdr:     "rgba(37,99,168,0.22)",
  red:         "#c0392b",
  redLight:    "rgba(192,57,43,0.10)",
  redBdr:      "rgba(192,57,43,0.22)",
  teal:        "#0f7b6c",
  tealLight:   "rgba(15,123,108,0.10)",
  tealBdr:     "rgba(15,123,108,0.22)",
  shadow:      "0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)",
  shadowMd:    "0 4px 12px rgba(0,0,0,0.08), 0 2px 4px rgba(0,0,0,0.04)",
} as const;
```

All lib files (`callSentiment.ts`, `colors.ts`, etc.) import from this file. The global CSS (applied from `app/layout.tsx`) also uses these values as CSS custom properties so Tailwind utility classes can reference them if needed.

---

### BUG-53 — MiscPage 4 Stat Cards Have No API Backing Beyond Total Count (**MEDIUM**)

**Problem:** The `MiscPage` renders 4 stat cards: "Misc Calls" (total count), "Avg Duration", "Disconnected" (count of calls with reason containing "Disconnected"), and "No Response" (count with reason containing "No"). The only existing endpoint is `GET /api/v1/analytics/misc-count` which returns `{ count: number }`. With pagination on the table (BUG-19 fix), the frontend can never compute Avg Duration, Disconnected count, or No Response count client-side — it only has the current page of results. All three extra stat cards would be zero or incorrect.

**Fix:** Expand `GET /api/v1/analytics/misc-count` to return all four aggregated values in a single query:

```
Response: {
  count: number,
  avg_duration_secs: number,
  disconnected_count: number,    -- WHERE misc_reason LIKE '%disconnect%' (case-insensitive)
  no_response_count: number      -- WHERE misc_reason LIKE '%no answer%' OR '%no response%'
}
```

The SQL is a single scan of `calls WHERE is_misc = TRUE` with conditional aggregation — no performance issue. This endpoint is still polled every 60 seconds for the sidebar badge and now also on page mount for the MiscPage stat cards.

---

### Documentation Clarification — EmpDashPage Daily Breakdown Chart Is Always Current Week

**This is not a bug but requires explicit documentation to prevent developer confusion.** In the design, `EmpDashPage` always renders the weekly bar chart (`weekData`) from a fixed `WEEK_DAYS` array (Mon–Sun of the current week). The date range pills (`dateRange`) affect only the stat cards and the call history table — they do NOT filter the bar chart. The bar chart always shows the current calendar week regardless of the selected date range. The `GET /analytics/employee/:id` endpoint's `daily_breakdown` response therefore always returns 7 days (Mon–Sun of current week) irrespective of `date_from` / `date_to` params — those params only affect `total_calls`, `inbound`, `outbound`, `avg_duration_secs`, and `csat_score`. Developer B must NOT attempt to make the bar chart date-range-aware. The chart subtitle reads "Weekly call distribution for {name}" which is permanently accurate.

---

## 3. Feature Inventory (Verified Against call.jsx)

All features confirmed against the complete design file.

### 3.1 Navigation / Shell (Both Roles)
- Persistent left sidebar (240px), background `#faf8f4`, `DM Sans` font [BUG-41 fix]
- Groups: Analytics (Dashboard, Employees), Calls (Recordings, Misc Calls), Management (Lines, Intercoms, Team)
- Employees nav item expands to per-agent sub-items, dynamically loaded from `GET /api/v1/employees` (owner only) [BUG-33 fix]
- Sub-items use `color_index` for agent avatar color [BUG-21 fix]
- Mobile: hamburger → slide-in drawer, z-index 300, backdrop z-index 290
- Topbar: breadcrumb, **current month/year label (dynamic, not hardcoded)** [BUG-49 fix], LIVE indicator dot [BUG-08 fix]
- Sidebar footer: FTP/Phone sync pill (green/grey) + AI queue pill (orange) [BUG-07 fix]
- Sidebar footer: logged-in user avatar (initials) + name + role label
- Badge on "Misc Calls" nav item (polls `GET /analytics/misc-count` every 60s)

### 3.2 Dashboard / Overview Page (Owner only)
- 4 stat cards: Total Calls, Inbound, Outbound, Avg Duration — deltas from `mom_delta` [BUG-23 fix]
- Pie chart — Call Direction Split
- Pie chart — Team Call Split (uses `team_split` with `color_index`) [BUG-21 fix]
- Key Insight panel: top agent + `top_line` from API [BUG-18 fix]
- Line chart — Weekly Activity (uses `toLineChartData` transform) [BUG-22, BUG-37 fix]
- CSAT gauge — filterable by agent; dropdown populated from `team_split`, no extra fetch [BUG-32 fix]
- CSAT mini-stats: Resolved + Escalated counts [BUG-17 fix]
- Recent Calls table — 5 rows fixed, no pagination; "View all →" navigates to **Employees page** [BUG-39 fix]
- Line Status grid — 10 boxes, `call_count_today` per line [BUG-06 fix]

### 3.3 Employees Page (Owner only) — Two States [BUG-30, BUG-43 fix]
**State "All Agents":** Chips row, `EmployeeFilterDropdown`, count label, `CallTable` with pagination, `CallPanel` on click.
**State "Single Agent":** Chips row (selected highlighted), 4 stat cards, `BarChart` (uses `toBarChartData`) [BUG-31, BUG-37 fix], `EmployeeFilterDropdown`, count label, `CallTable` filtered + paginated, "← All employees" button.
Call list data comes from `GET /api/v1/calls?employee_id={id}`. Stat cards come from `GET /analytics/employee/:id`.

### 3.4 Per-Agent Dashboard (`/employees/[id]`) — Standalone Page
- Agent avatar header (`color_index` background) [BUG-21 fix]
- Date-range filter pills (affects stat cards and call table only — NOT the weekly chart)
- 4 stat cards
- `BarChart` — "Daily Breakdown", always shows current week [see Documentation Clarification above]
- Call History table with pagination [BUG-19 fix]
- `CallPanel` on row click

### 3.5 Recordings Page (Both roles)
- Phone search bar (raw input sent to API; API normalizes) [BUG-44 fix]
- Filter row: **Date, Line (dynamic), Type, Agent (Owner only — hidden for employees), IC (dynamic), Source** [BUG-38, BUG-47 fix]
- Source filter translation: korecall → `source` param; device UUID → `source + device_id` params [BUG-46 fix]
- Employees list for Agent filter from `GET /api/v1/employees/names` (owner only) [BUG-47 fix]
- `dropRefs` has 6 entries including `source` [BUG-38 fix]
- Call table with AI-based sentiment emoji [BUG-35 fix], `student_name`, pagination [BUG-19 fix]
- `CallPanel` on row click, loading skeleton state [BUG-42 fix]

### 3.6 Misc Calls Page (Both roles)
- 4 stat cards: Total Misc, Avg Duration, Disconnected count, No Response count — all from expanded `misc-count` endpoint [BUG-53 fix]
- Table: 9 columns — Date, Time, Line, IC, Type, Number, Duration, Reason, Source [BUG-16 fix]
- Source column uses `source_label`

### 3.7 Lines Page (Owner only)
- Circular progress indicator (orange) with `assignedCount / 10`
- Table: Line, Agent, Purpose, Calls Today (with mini progress bar), Action [BUG-06 fix]
- Assign modal: agent selector (active only, from `GET /api/v1/employees/names`) + purpose note

### 3.8 Intercoms Page (Owner only)
- Circular progress indicator (teal)
- Table: Intercom, Phone Number, Calls (total count with mini progress bar), Action [BUG-29 fix]
- Assign modal: phone number input only

### 3.9 Team Page (Owner only)
- 3 summary stat cards: Total Agents, Active, Inactive (computed client-side from `GET /employees` response)
- Agent roster; main row shows: avatar, name, status badge, phone, and **quick stats (total/inbound/outbound/avg) from `call_stats` in employee response** [BUG-45 fix]
- Expandable row: assigned lines + purpose notes, Deactivate/Reactivate button
- Add Agent modal: 5 fields — Full Name, Email, Phone (optional), Password (min 8 chars), Role [BUG-14 fix]
- Generate API Key button (QR code, shown once) [BUG-02 fix]

### 3.10 Call Detail Panel
- Header: phone (+91 prefix), date/time, line, intercom + `intercom_phone_number` [BUG-34 fix], agent, source device tag
- Three tabs: Summary | Transcript | Details
- Summary: `AudioPlayer` (null-safe) [BUG-11 fix], 3 mini-stats, AI Summary, Mark as Resolved/Escalated [BUG-17 fix]
- Transcript: chat-bubble layout; right/orange = Agent, left/grey = Caller
- Details: Phone, Student, Date, Time, Line, Intercom+phone, Agent, Direction, Duration, AI Status (proper tag variant) [BUG-40 fix], Resolution Status

### 3.11 Student Name Resolution
- `students` table, CSV import, individual PATCH + DELETE [BUG-04, BUG-05, BUG-25 fix]
- Auto-lookup at call ingestion (FTP and Android)

### 3.12 Android App (Minimal)
- `LoginScreen`: API key text input + QR scanner [BUG-02 fix]
- `DeviceSetupScreen`: device name, phone number, storage path; offline queue indicator [BUG-26 fix]
- Background sync every 15 min; `line_number = null`, `intercom_code = null` for all uploads [BUG-20]

---

## 4. Architecture Overview

```
┌─────────────────────────────┐     HTTPS/REST      ┌──────────────────────────────┐
│   Next.js Web Dashboard     │◄───────────────────►│   Node.js / Express API      │
│   DM Sans, App Router       │  credentials:include │   /api/v1/...                │
│   Owner + Employee views    │  [BUG-51 fix]        └────────────┬─────────────────┘
└─────────────────────────────┘                                   │
                                                     ┌────────────▼─────────────────┐
┌─────────────────────────────┐     HTTPS/REST       │      PostgreSQL DB            │
│  React Native Android App   │◄───────────────────►│  (calls, employees, lines,   │
│  (Employee phones)          │  Bearer token in body│   intercoms, devices,        │
└─────────────────────────────┘  [BUG-51 fix]        │   students, ai_jobs,         │
                                                     │   system_state)              │
┌─────────────────────────────┐                      └────────────┬─────────────────┘
│  FTP Ingestion Service      │   Direct DB + R2                  │
│  (Node.js daemon)           │◄──────────────────  ┌────────────▼─────────────────┐
│  Polls KoreCall FTP         │  No API calls        │   Bull Queue + Redis          │
└─────────────────────────────┘  [BUG-12 fix]        │   Whisper → Transcript       │
                                                     │   GPT-4o-mini → Summary      │
                                                     └────────────┬─────────────────┘
                                                                   │
                                                     ┌────────────▼─────────────────┐
                                                     │   Cloudflare R2              │
                                                     │   (Audio file storage)       │
                                                     └──────────────────────────────┘
```

---

## 5. Tech Stack Decisions

| Layer | Choice | Reason |
|-------|--------|--------|
| Web Frontend | Next.js 14 (App Router) | SSR for auth guard |
| API | Node.js + Express + TypeScript | No over-engineering |
| Database | PostgreSQL | Relational, strong querying |
| File Storage | Cloudflare R2 | S3-compatible, zero egress cost |
| Queue | Bull + Redis | Async AI job processing |
| AI — Transcription | OpenAI Whisper (`whisper-1`) | Best Hindi/English code-switching |
| AI — Summary + Sentiment + Diarization | OpenAI GPT-4o-mini | Cost-effective |
| Mobile App | React Native (Android only) | iOS blocks call recording in v1 |
| FTP Client | `basic-ftp` npm | Simple, promise-based |
| Auth | JWT (HS256), httpOnly SameSite=None cookie (web), Bearer token (mobile) | [BUG-51 fix] |
| Font | DM Sans (Google Fonts) | Matches design exactly [BUG-41 fix] |
| Deployment — API | DigitalOcean VPS + PM2 | ~$12/mo |
| Deployment — Web | Vercel | Free tier, auto-deploy |
| Deployment — DB | Supabase PostgreSQL | Managed |
| Deployment — Redis | Upstash Redis | Serverless free tier |

---

## 6. Repository & Folder Structure

### 6.1 Monorepo Root
```
callflow/
├── apps/
│   ├── web/
│   ├── api/
│   ├── mobile/
│   └── ftp-service/
├── packages/
│   └── shared-types/
├── docker-compose.yml
├── .env.example
└── README.md
```

### 6.2 Web App (`apps/web/`)
```
apps/web/
├── app/
│   ├── layout.tsx                        ← DM Sans font import [BUG-41 fix]
│   ├── page.tsx                          ← Redirects based on role
│   ├── login/page.tsx
│   └── dashboard/
│       ├── overview/page.tsx             ← Owner only
│       ├── employees/
│       │   ├── page.tsx                  ← EmployeePage (two-state) [BUG-30, BUG-43 fix]
│       │   └── [id]/page.tsx             ← EmpDashPage (standalone per-agent)
│       ├── recordings/page.tsx           ← Both roles
│       ├── misc/page.tsx                 ← Both roles
│       ├── lines/page.tsx                ← Owner only
│       ├── intercoms/page.tsx            ← Owner only
│       └── team/page.tsx                 ← Owner only
├── components/
│   ├── layout/
│   │   ├── Sidebar.tsx                   ← Dynamic employee nav [BUG-33 fix]
│   │   └── Topbar.tsx                    ← LIVE indicator, dynamic month label [BUG-49 fix]
│   ├── calls/
│   │   ├── CallTable.tsx                 ← loading + pagination props [BUG-19, BUG-42 fix]
│   │   ├── MobileCallCard.tsx            ← uses callSentiment(call) [BUG-35 fix]
│   │   ├── CallPanel.tsx                 ← intercom_phone_number, resolution, aiStatusTag
│   │   └── CallFilters.tsx               ← 6 filters (5 for employees), dynamic from API
│   ├── employees/
│   │   └── EmployeeFilterDropdown.tsx    ← Combined Agent+Type dropdown [BUG-36 fix]
│   └── ui/
│       ├── Card.tsx
│       ├── Tag.tsx
│       ├── StatCard.tsx
│       ├── WABtn.tsx
│       ├── AudioPlayer.tsx
│       ├── PieChart.tsx
│       ├── LineChart.tsx
│       ├── BarChart.tsx
│       ├── GaugeMeter.tsx
│       └── Pagination.tsx
├── hooks/
│   ├── useSystemStatus.ts               ← Polls /system/status every 30s
│   └── useAuth.ts
├── lib/
│   ├── api.ts                           ← All fetch wrappers with credentials:include [BUG-51 fix]
│   ├── constants.ts                     ← C design token object [BUG-52 fix]
│   ├── chartTransforms.ts               ← toLineChartData, toBarChartData [BUG-37 fix]
│   ├── tagMaps.ts                       ← aiStatusTag() [BUG-40 fix]
│   ├── callSentiment.ts                 ← callSentiment(call) [BUG-48 fix, BUG-35 fix]
│   └── colors.ts                        ← eClr(colorIndex) with modulo [BUG-21, BUG-50 fix]
└── middleware.ts                         ← Route protection, role-based redirect
```

### 6.3 API App (`apps/api/src/`)
```
apps/api/src/
├── index.ts                              ← CORS with credentials:true [BUG-51 fix]
├── middleware/
│   ├── auth.ts
│   └── requireOwner.ts
├── routes/
│   ├── auth.routes.ts
│   ├── calls.routes.ts
│   ├── analytics.routes.ts
│   ├── employees.routes.ts
│   ├── lines.routes.ts
│   ├── intercoms.routes.ts
│   ├── devices.routes.ts
│   ├── students.routes.ts
│   └── system.routes.ts
├── controllers/
├── services/
│   ├── studentLookup.service.ts
│   ├── storage.service.ts
│   └── ai.service.ts
├── queue/
└── db/
    └── migrations/
        ├── 001_initial.sql
        ├── 002_students.sql
        └── 003_ai_jobs_system_state.sql
```

### 6.4 FTP Service (`apps/ftp-service/src/`)
```
apps/ftp-service/src/
├── index.ts
├── ftpPoller.ts
└── filenameParser.ts
```

### 6.5 Mobile App (`apps/mobile/src/`)
```
apps/mobile/src/
├── screens/
│   ├── LoginScreen.tsx
│   └── DeviceSetupScreen.tsx
├── services/
│   ├── callSync.ts
│   └── offlineQueue.ts
└── store/
    └── useStore.ts
```

---

## 7. Database Schema

Migration sequence locked: 001 → 002 → 003. [BUG-27 fix]

```sql
-- ─────────────────────────────────────────────────────────────────────
-- MIGRATION 001 — Core Tables
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE employees (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(100) NOT NULL,
  email         VARCHAR(100) UNIQUE NOT NULL,    -- [BUG-01 fix]
  phone         VARCHAR(15),
  role          VARCHAR(10) NOT NULL DEFAULT 'employee'
                CHECK (role IN ('owner','employee')),
  status        VARCHAR(10) NOT NULL DEFAULT 'active'
                CHECK (status IN ('active','inactive')),
  password_hash VARCHAR(100) NOT NULL,           -- bcrypt 12 rounds [BUG-28 fix]
  api_key_hash  VARCHAR(100),                    -- SHA-256, NULL until generated
  color_index   INTEGER NOT NULL DEFAULT 0,      -- [BUG-21 fix]
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE lines (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  line_number VARCHAR(5) NOT NULL UNIQUE,
  employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
  purpose     VARCHAR(200),
  assigned_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE intercoms (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  intercom_code VARCHAR(10) NOT NULL UNIQUE,   -- '601'..'610'
  phone_number  VARCHAR(15),
  assigned_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE devices (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_name  VARCHAR(100) NOT NULL,
  phone_number VARCHAR(15) NOT NULL,
  employee_id  UUID REFERENCES employees(id) ON DELETE SET NULL,
  storage_path VARCHAR(500),
  last_sync_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE calls (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source          VARCHAR(20) NOT NULL DEFAULT 'korecall'
                  CHECK (source IN ('korecall','android_app')),
  source_file_key VARCHAR(500) UNIQUE,
  device_id       UUID REFERENCES devices(id) ON DELETE SET NULL,
  line_number     VARCHAR(5),        -- NULL for android_app [BUG-20]
  intercom_code   VARCHAR(10),       -- NULL for android_app [BUG-20]
  call_direction  VARCHAR(10) NOT NULL
                  CHECK (call_direction IN ('inbound','outbound')),
  caller_phone    VARCHAR(30),
  student_name    VARCHAR(150),      -- [BUG-04 fix]
  called_at       TIMESTAMPTZ NOT NULL,
  duration_secs   INTEGER NOT NULL DEFAULT 0,
  employee_id     UUID REFERENCES employees(id) ON DELETE SET NULL,
  is_misc         BOOLEAN NOT NULL DEFAULT FALSE,
  misc_reason     VARCHAR(200),
  resolution_status VARCHAR(15)
                  CHECK (resolution_status IN ('resolved','escalated')), -- [BUG-17 fix]
  audio_storage_key VARCHAR(500),    -- NULL if upload failed [BUG-11 fix]
  ai_status       VARCHAR(20) NOT NULL DEFAULT 'pending'
                  CHECK (ai_status IN ('pending','processing','done','failed')),
  summary         TEXT,
  transcript_raw  TEXT,
  transcript_json JSONB,             -- [{ speaker: 'Agent'|'Caller', text: '...' }]
  sentiment       VARCHAR(10)
                  CHECK (sentiment IN ('positive','negative','neutral')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_calls_called_at    ON calls(called_at DESC);
CREATE INDEX idx_calls_employee_id  ON calls(employee_id);
CREATE INDEX idx_calls_caller_phone ON calls(caller_phone);
CREATE INDEX idx_calls_ai_status    ON calls(ai_status);
CREATE INDEX idx_calls_is_misc      ON calls(is_misc);
CREATE INDEX idx_calls_student_name ON calls(student_name);
CREATE INDEX idx_calls_line_number  ON calls(line_number);
CREATE INDEX idx_calls_source       ON calls(source);

-- ─────────────────────────────────────────────────────────────────────
-- MIGRATION 002 — Students
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE students (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       VARCHAR(150) NOT NULL,
  phone      VARCHAR(15) UNIQUE NOT NULL,
  notes      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_students_phone ON students(phone);

-- ─────────────────────────────────────────────────────────────────────
-- MIGRATION 003 — AI Jobs + System State [BUG-27 fix: locked order]
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE ai_jobs (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id    UUID NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  status     VARCHAR(20) NOT NULL DEFAULT 'queued'
             CHECK (status IN ('queued','processing','done','failed')),
  error_msg  TEXT,
  started_at TIMESTAMPTZ,
  done_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE system_state (
  id                   INTEGER PRIMARY KEY DEFAULT 1,
  ftp_last_sync_at     TIMESTAMPTZ,
  android_last_sync_at TIMESTAMPTZ,
  CHECK (id = 1)
);
INSERT INTO system_state (id) VALUES (1);
```

---

## 8. API Specification

Base URL: `/api/v1`

All routes except `POST /auth/login` and `POST /mobile/auth/login` require `Authorization: Bearer <jwt>` (mobile) or the httpOnly session cookie (web, sent automatically via `credentials: include`).

### 8.1 Auth

#### `POST /auth/login` — Web Login [BUG-51 fix]
```
Request:  { email: string, password: string }
Response: { user: { id, name, email, role, color_index } }
          Sets-Cookie: token=<jwt>; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=28800
```
Token NOT returned in body for web. JWT payload: `{ sub, role, name, color_index, iat, exp }`.
Rate limit: 5 / 15 min per IP.

#### `GET /auth/me`
```
Response: { id, name, email, role, color_index }
```

### 8.2 Calls

#### `GET /api/v1/calls`
Query: `date_from`, `date_to`, `line`, `direction`, `employee_id`, `intercom`, `source`, `device_id`, `phone` (partial), `is_misc`, `limit` (max 200, default 50), `offset`

Employee role: auto-scoped to `employee_id = req.user.sub`.

Each `Call` object includes:
- `source_label: string` — "KoreCall" or device name [BUG-16 fix]
- `intercom_phone_number: string | null` — from JOIN on intercoms [BUG-34 fix]
- `color_index: number` — from JOIN on employees [BUG-21 fix]

```
Response: { data: Call[], total: number, limit: number, offset: number }
```

#### `GET /api/v1/calls/:id`
```
Response: Call & {
  audio_presigned_url: string | null,   -- [BUG-11 fix]
  intercom_phone_number: string | null  -- [BUG-34 fix]
}
```
15-min presigned URL. `audio_storage_key` never returned to client.

#### `POST /api/v1/calls/search`
```
Request:  { phone: string, limit?: number, offset?: number }
Response: { calls: Call[], total: number, found: boolean }
```
API normalizes phone: strip non-digits, match last 10 digits. [BUG-44 fix]

#### `PATCH /api/v1/calls/:id/resolution` — Both roles, employee scoped to own calls [BUG-17 fix]
```
Request:  { resolution_status: 'resolved' | 'escalated' | null }
Response: { id, resolution_status }
```

### 8.3 Analytics

#### `GET /api/v1/analytics/overview` — Owner only
Query: `month` (YYYY-MM, default current), `employee_id` (optional for CSAT scoping)
```
Response: {
  total_calls: number,
  inbound: number,
  outbound: number,
  avg_duration_secs: number,
  mom_delta: {
    total_pct: number | null,
    inbound_pct: number | null,
    outbound_pct: number | null,
    avg_duration_secs: number
  },                                              -- [BUG-23 fix]
  direction_split: { inbound_pct, outbound_pct },
  team_split: [{ employee_id, name, count, pct, color_index }],  -- [BUG-21 fix]
  weekly_activity: [{ day_label, inbound, outbound }],           -- [BUG-22 fix]
  csat_score: number,
  resolved_count: number,                         -- [BUG-17 fix]
  escalated_count: number,                        -- [BUG-17 fix]
  top_line: { line_number, call_count },          -- [BUG-18 fix]
  line_status: [{ line, employee_name, call_count_today }],      -- [BUG-06 fix]
  recent_calls: Call[5]
}
```
CSAT dropdown built from `team_split` — no extra fetch needed. [BUG-32 fix]

#### `GET /api/v1/analytics/employee/:id`
Query: `date_from`, `date_to`
```
Response: {
  total_calls, inbound, outbound, avg_duration_secs,
  csat_score: number,
  daily_breakdown: [{            -- ALWAYS 7 days: Mon–Sun of current week [BUG-31 fix]
    date: string,                -- ISO "2025-07-01"
    day_label: string,           -- "Mon"
    inbound: number,
    outbound: number,
    total: number
  }]
  -- NOTE: daily_breakdown is NOT filtered by date_from/date_to.
  -- It always returns the current calendar week.
  -- date_from/date_to only affect total_calls, inbound, outbound, avg_duration_secs, csat_score.
}
```
Owner sees any; employee sees own only.

#### `GET /api/v1/analytics/misc-count` — Both roles [BUG-53 fix]
```
Response: {
  count: number,
  avg_duration_secs: number,
  disconnected_count: number,   -- WHERE misc_reason ILIKE '%disconnect%'
  no_response_count: number     -- WHERE misc_reason ILIKE '%no answer%' OR ILIKE '%no response%'
}
```
All four values computed in one SQL scan. Polled every 60s for sidebar badge; also fetched on MiscPage mount.

### 8.4 System Status — Both roles [BUG-07 fix]

#### `GET /api/v1/system/status`
```
Response: {
  ftp_last_sync_at: string | null,
  android_last_sync_at: string | null,
  ai_queue_pending: number
}
```

### 8.5 Employees

#### `GET /api/v1/employees` — Owner only
```
Response: [{
  id, name, email, phone, role, status, color_index,
  call_stats: {              -- [BUG-45 fix: all-time stats via LEFT JOIN aggregate]
    total: number,
    inbound: number,
    outbound: number,
    avg_duration_secs: number
  }
}]
```

#### `GET /api/v1/employees/names` — Both roles [BUG-47 fix]
```
Response: [{ id: string, name: string, color_index: number }]
```
Returns active employees only. Used by: Sidebar (dynamic nav), LinesPage assign modal, RecordingsPage agent filter (owner only).

#### `POST /api/v1/employees` — Owner only
```
Request: { name, email, phone?, role?, password }
```
Auto-assigns `color_index = MAX(color_index) + 1`. bcrypt 12 rounds. [BUG-21, BUG-28 fix]

#### `GET /api/v1/employees/:id` — Owner or self
#### `PATCH /api/v1/employees/:id` — Owner only
```
Request: { name?, phone?, status? }
```
#### `POST /api/v1/employees/:id/api-key` — Owner only
```
Response: { api_key: string }  -- Shown once. SHA-256 hash stored. [BUG-02 fix]
```

### 8.6 Lines

#### `GET /api/v1/lines` — Both roles
```
Response: [{
  id, line_number, employee_id, employee_name, employee_color_index,
  purpose, assigned_at,
  call_count_today: number   -- [BUG-06 fix]
}]
```
Used by: LinesPage, RecordingsPage Line filter dropdown.

#### `PATCH /api/v1/lines/:id` — Owner only
```
Request: { employee_id: string | null, purpose?: string }
```

### 8.7 Intercoms

#### `GET /api/v1/intercoms` — Both roles
```
Response: [{ id, intercom_code, phone_number, assigned_at, call_count_total }]  -- [BUG-29 fix]
```
Used by: IntercomPage, RecordingsPage IC filter dropdown.

#### `PATCH /api/v1/intercoms/:id` — Owner only
```
Request: { phone_number: string | null }
```

### 8.8 Devices

#### `GET /api/v1/devices` — Owner only (full detail)
#### `GET /api/v1/devices/names` — Both roles [BUG-09 fix]
```
Response: [{ id: string, device_name: string }]
```
#### `POST /api/v1/devices` — Owner only
#### `DELETE /api/v1/devices/:id` — Owner only [BUG-24 fix]

### 8.9 Students — [BUG-05, BUG-25 fix]

#### `POST /api/v1/students/import` — Owner only (multipart CSV)
```
Response: { imported: number, skipped: number, errors: string[] }
```
#### `GET /api/v1/students` — Owner only
#### `PATCH /api/v1/students/:id` — Owner only
#### `DELETE /api/v1/students/:id` — Owner only

### 8.10 Mobile App Endpoints

All require `X-API-Key: <employee_api_key>` header.

#### `POST /api/v1/mobile/auth/login` [BUG-02 fix]
```
Request:  { api_key: string }
Response: { token: string, employee: { id, name, color_index }, device_id? }
```
Token returned in body (not cookie) for mobile. [BUG-51 fix]
Rate limit: 10 / hour per API key.

#### `POST /api/v1/mobile/device/setup`
```
Request:  { device_name, phone_number, storage_path }
Response: { device_id: string }
```

#### `POST /api/v1/mobile/calls` — Upload recording [BUG-20]
```
Fields (multipart): device_id, caller_phone, call_direction, called_at,
                    duration_secs, is_misc, misc_reason?, audio?
```
`line_number` and `intercom_code` are always null for Android uploads. Updates `system_state.android_last_sync_at`.

#### `GET /api/v1/mobile/sync-status`
```
Response: { last_sync_at: string, pending_ai_jobs: number }
```

---

## 9. KoreCall FTP Ingestion Service

### 9.1 Corrected Filename Parser [BUG-03 fix]
```typescript
// apps/ftp-service/src/filenameParser.ts
// (\d{1,3})? handles 1–3 digit intercom/extension codes
const FILE_REGEX = /^(\d{2})--([AB])-(\d{1,3})?-*(\d{14})-(.+)\.wav$/i;

export function parseFilename(filename: string): ParsedFilename | null {
  const m = filename.match(FILE_REGEX);
  if (!m) return null;
  const [, line, dir, intercom, ts, phone] = m;
  return {
    lineNumber:   line,
    direction:    dir === 'A' ? 'inbound' : 'outbound',
    intercomCode: intercom || null,
    calledAt:     new Date(
      `${ts.slice(0,4)}-${ts.slice(4,6)}-${ts.slice(6,8)}T` +
      `${ts.slice(8,10)}:${ts.slice(10,12)}:${ts.slice(12,14)}`
    ),
    callerPhone:  phone === 'Unknown' ? 'Unknown' : phone,
    rawFilename:  filename,
  };
}
```

### 9.2 Polling Loop
- Cron: `*/15 9-18 * * 1-6` (Mon–Sat, business hours)
- Writes directly to DB and R2 — no API calls [BUG-12 fix]
- Updates `system_state.ftp_last_sync_at` after each successful poll [BUG-07 fix]
- `duration < 30s` → `is_misc = true`, `misc_reason = 'Short duration — possible disconnect'` [BUG-13 fix]
- Deduplication via `source_file_key` unique constraint (ON CONFLICT DO NOTHING)
- Student name lookup on every call: `SELECT name FROM students WHERE phone = $1` [BUG-05 fix]
- Employee lookup: `SELECT employee_id FROM lines WHERE line_number = $1`
- R2 upload failure handled gracefully: `audio_storage_key = null` on failure [BUG-11 fix]
- Queues AI job only for non-misc calls with successful audio upload

---

## 10. Android App

### 10.1 Screens

**`LoginScreen.tsx`** [BUG-02 fix]: Single text input "Enter your API Key" + QR scanner button. On success: store JWT (Bearer token) in Zustand + AsyncStorage. Navigate to DeviceSetupScreen if not registered.

**`DeviceSetupScreen.tsx`** [BUG-26 fix]: Device name, phone number, storage path. Shows offline queue indicator: "X calls pending upload" banner (amber) when network is unavailable and `offlineQueue.length > 0`.

### 10.2 Required Permissions (Requested on First Launch)
`READ_CALL_LOG`, `READ_EXTERNAL_STORAGE`, `READ_PHONE_STATE`, `FOREGROUND_SERVICE`, `INTERNET`

### 10.3 Null Line Contract [BUG-20]
All Android uploads produce `line_number = null` and `intercom_code = null`. The web dashboard renders these as "—" in table cells. The Line Status grid on the Overview page does NOT count Android calls (KoreCall-only metric).

### 10.4 Background Sync — Every 15 Minutes
Maps Android call types to `misc_reason` categories [BUG-13 fix]: `MISSED` → 'No answer from customer', `REJECTED` → 'Disconnected immediately', short `INCOMING`/`OUTGOING` → 'Short duration — possible disconnect'. Failed uploads queued in AsyncStorage [BUG-26 fix].

---

## 11. AI Pipeline

### Step 1 — Whisper Transcription
```typescript
const transcriptRaw = await openai.audio.transcriptions.create({
  file: fs.createReadStream(tmpPath),
  model: 'whisper-1',
  language: 'hi',        // Hindi primary; code-switching handled automatically
  response_format: 'text',
});
```

### Step 2 — Diarization (GPT-4o-mini, temperature 0.1)
Separates transcript into Agent/Caller turns. Returns:
```json
[{ "speaker": "Agent", "text": "..." }, { "speaker": "Caller", "text": "..." }]
```

### Step 3 — Summary + Sentiment (GPT-4o-mini)
Returns `{ "summary": "...", "sentiment": "positive"|"negative"|"neutral" }`.

### Step 4 — DB Update
```sql
UPDATE calls SET
  ai_status = 'done', transcript_raw = $1, transcript_json = $2,
  summary = $3, sentiment = $4, updated_at = NOW()
WHERE id = $5
```

### CSAT Formula
```sql
ROUND(100.0 * COUNT(*) FILTER (WHERE sentiment = 'positive') /
      NULLIF(COUNT(*) FILTER (WHERE ai_status = 'done'), 0)) AS csat_score
```

### Sentiment in Frontend [BUG-35 fix]
```typescript
// lib/callSentiment.ts — imports C from lib/constants.ts [BUG-52 fix]
import { C } from './constants';

export function callSentiment(call: Call) {
  if (call.ai_status === 'done' && call.sentiment) {
    if (call.sentiment === 'positive') return { e: '😊', label: 'Positive',  color: C.green  };
    if (call.sentiment === 'negative') return { e: '😞', label: 'Negative',  color: C.red    };
    return                                     { e: '😐', label: 'Neutral',   color: C.orange };
  }
  if (call.ai_status === 'pending' || call.ai_status === 'processing')
    return { e: '⏳', label: 'Pending', color: C.muted };
  return { e: '—', label: 'Unknown', color: C.dim };
}
```
Replaces every usage of the old `sentiment(duration)` function across `CallRow.tsx` and `MobileCallCard.tsx`.

---

## 12. RBAC System

### Two Roles

| Role | Access |
|------|--------|
| **owner** | All pages, all employees' calls, analytics, team management |
| **employee** | Own `EmpDashPage` + Recordings (auto-scoped to own calls) |

### JWT Claims
```json
{ "sub": "uuid", "role": "owner", "name": "Admin", "color_index": 0, "iat": ..., "exp": ... }
```

### API-Level Protection
- `requireOwner` middleware on: `/analytics/overview`, `GET /employees`, `POST /employees`, `PATCH /lines/:id`, `PATCH /intercoms/:id`, `GET /devices`, `POST /devices`, `DELETE /devices/:id`, all students routes, `GET /analytics/misc-count` (both roles)
- Employee auto-scoping enforced at controller level for: `GET /calls`, `POST /calls/search`, `PATCH /calls/:id/resolution`, `GET /analytics/employee/:id`
- Both roles can access: `GET /lines`, `GET /intercoms`, `GET /devices/names`, `GET /employees/names`, `GET /system/status`, `GET /analytics/misc-count`

### Frontend Route Protection (`middleware.ts`)
```typescript
const OWNER_ONLY_PATHS = [
  '/dashboard/overview',
  '/dashboard/employees',  // list page only; [id] is both roles
  '/dashboard/lines',
  '/dashboard/intercoms',
  '/dashboard/team',
];
// Employee accessing these → redirect to /dashboard/employees/{sub}
```

### Login Redirect Flow
- Owner (`role='owner'`) → `/dashboard/overview`
- Employee (`role='employee'`) → `/dashboard/employees/{sub}`

---

## 13. Page-by-Page Frontend Breakdown

### Route to Component Mapping

| Route | Component | Role |
|-------|-----------|------|
| `/dashboard/overview` | OverviewPage | Owner only |
| `/dashboard/employees` | EmployeePage (two-state) | Owner only |
| `/dashboard/employees/[id]` | EmpDashPage (standalone) | Owner (any), Employee (own) |
| `/dashboard/recordings` | RecordingsPage | Both |
| `/dashboard/misc` | MiscPage | Both |
| `/dashboard/lines` | LinesPage | Owner only |
| `/dashboard/intercoms` | IntercomPage | Owner only |
| `/dashboard/team` | TeamPage | Owner only |

### Component Build Order (Week 1 before anything else)

All items below must be in `lib/` before any page work starts:

1. `lib/constants.ts` — `C` design token object [BUG-52 fix] — imported by all other lib files
2. `lib/colors.ts` — `AGENT_PALETTE` + `eClr(colorIndex % AGENT_PALETTE.length)` [BUG-50 fix]
3. `lib/chartTransforms.ts` — `toLineChartData`, `toBarChartData` [BUG-37 fix]
4. `lib/tagMaps.ts` — `aiStatusTag()` [BUG-40 fix]
5. `lib/callSentiment.ts` — `callSentiment(call)` [BUG-48 fix, BUG-35 fix]
6. `lib/api.ts` — all fetch wrappers with `credentials: 'include'` [BUG-51 fix]

Then shared UI components (also Week 1):

7. `Card`, `Tag`, `StatCard`, `Pagination`
8. `Sidebar.tsx` (dynamic employee nav via SWR on `/employees/names` for owner role)
9. `Topbar.tsx` (dynamic month/year label, LIVE indicator)

### Key Implementation Details

**`lib/colors.ts` — eClr with modulo [BUG-50 fix]:**
```typescript
import { C } from './constants';
export const AGENT_PALETTE = [
  { t: C.orange, bg: C.orangeLight, br: C.orangeBdr },
  { t: C.teal,   bg: C.tealLight,   br: C.tealBdr   },
  { t: C.blue,   bg: C.blueLight,   br: C.blueBdr   },
  { t: C.green,  bg: C.greenLight,  br: C.greenBdr  },
  { t: C.red,    bg: C.redLight,    br: C.redBdr    },
];
export const eClr = (colorIndex: number) =>
  AGENT_PALETTE[colorIndex % AGENT_PALETTE.length] ?? AGENT_PALETTE[0];
```

**`Topbar.tsx` — Dynamic month label [BUG-49 fix]:**
```tsx
// Replace hardcoded "July 2025" with:
const monthLabel = new Date().toLocaleString('default', { month: 'long', year: 'numeric' });
// Renders: "July 2025" today, "August 2025" next month — automatically correct.
```

**`CallFilters.tsx` — Source filter param translation [BUG-46 fix]:**
```typescript
export function buildSourceParams(sourceFilter: string): Partial<CallQueryParams> {
  if (sourceFilter === 'All')      return {};
  if (sourceFilter === 'korecall') return { source: 'korecall' };
  // Otherwise it's a device UUID from GET /devices/names
  return { source: 'android_app', device_id: sourceFilter };
}
```

**`CallFilters.tsx` — Agent filter RBAC [BUG-47 fix]:**
```tsx
// Only rendered for owner role. Employees don't see the Agent filter.
// Owner fetches from GET /api/v1/employees/names (not GET /employees).
{role === 'owner' && (
  <DropBtn id="agent" label="Agent" ...>
    {['All', ...employeeNames?.map(e => e.name) ?? []].map(n => (
      <DropItem key={n} label={n === 'All' ? 'All Agents' : n} val={n} ... />
    ))}
  </DropBtn>
)}
```

**`TeamPage` — Quick stats from `call_stats` [BUG-45 fix]:**
```tsx
// Employee roster rows use call_stats directly from GET /employees response
// No separate fetch needed per employee
const { data: employees } = useSWR('/api/v1/employees');

// In each roster row (main row, always visible):
<div>{e.call_stats.total} Calls</div>
<div>{e.call_stats.inbound} In</div>
<div>{e.call_stats.outbound} Out</div>
<div>{fmtS(e.call_stats.avg_duration_secs)} Avg</div>
```

**`MiscPage` — 4 stat cards [BUG-53 fix]:**
```tsx
// GET /analytics/misc-count now returns all four values
const { data: miscStats } = useSWR('/api/v1/analytics/misc-count');

<StatCard label="Misc Calls"   value={miscStats?.count}              .../>
<StatCard label="Avg Duration" value={fmtS(miscStats?.avg_duration_secs)} .../>
<StatCard label="Disconnected" value={miscStats?.disconnected_count} .../>
<StatCard label="No Response"  value={miscStats?.no_response_count}  .../>
```

**EmployeePage State Machine [BUG-30, BUG-43 fix]:**
```tsx
// employees/page.tsx
const [active, setActive] = useState<string>('All');  // 'All' or employee UUID

// State 1 — active === 'All':
// chips → EmployeeFilterDropdown → count label → CallTable (paginated, all employees)
// Fetch: GET /calls with no employee_id filter

// State 2 — active !== 'All' (a UUID):
// chips (selected highlighted) → 4 stat cards → BarChart → EmployeeFilterDropdown
// → count label → CallTable (filtered to employee, paginated)
// Fetch: GET /analytics/employee/:id (for stat cards + bar chart)
// Fetch: GET /calls?employee_id={active} (for call table)

// Chip click → setActive(employeeId) — same URL, no route change
// "← All employees" button → setActive('All')
// Sidebar sub-item click → router.push('/dashboard/employees/{id}') → EmpDashPage
```

**EmpDashPage — Bar chart is always current week [Documentation Clarification]:**
```tsx
// EmpDashPage date range pills filter stat cards and call table only.
// The BarChart shows current-week daily_breakdown from GET /analytics/employee/:id.
// daily_breakdown is NOT filtered by dateRange. This matches the design behavior.
// Subtitle: "Weekly call distribution for {name}" — permanently accurate.
const chartData = toBarChartData(analyticsData.daily_breakdown);
// Pass to BarChart regardless of current dateRange state.
```

**CSAT Gauge Wiring [BUG-32 fix]:**
```tsx
// In OverviewPage — built from team_split, no extra fetch:
const [csatEmployeeId, setCsatEmployeeId] = useState<string | null>(null);
// On select change: refetch /analytics/overview?employee_id={csatEmployeeId}
<select onChange={e => { setCsatEmployeeId(e.target.value || null); }}>
  <option value="">Overall</option>
  {analytics.team_split.map(e => (
    <option key={e.employee_id} value={e.employee_id}>{e.name}</option>
  ))}
</select>
```

**"View All" navigation [BUG-39 fix]:**
```tsx
// OverviewPage Recent Calls "View all →" → Employees, NOT Recordings
<button onClick={() => router.push('/dashboard/employees')}>View all →</button>
```

---

## 14. Security

- Web JWT: HS256, 8h expiry, httpOnly cookie, SameSite=None, Secure [BUG-51 fix]
- Mobile JWT: HS256, 2h expiry, returned in response body, stored in AsyncStorage
- Mobile API key: SHA-256 hash in DB, exchanged for short-lived JWT on login
- Password: bcrypt 12 rounds, min 8 / max 72 chars [BUG-28 fix]
- Never return `audio_storage_key` to client — presigned URLs only [BUG-11 fix]
- Zod validation: phone (10–13 digits), email (RFC 5322), file MIME whitelist, UUID params
- SQL: parameterized queries only, zero string interpolation
- Rate limits: web login 5/15min, mobile upload 100/hr, all others 200/min
- CORS: `WEB_ORIGIN` env var only, `credentials: true`, never `*` [BUG-51 fix]
- Employee data isolation enforced at API level, not frontend

---

## 15. Environment Variables

### `apps/api/.env`
```
NODE_ENV=production
PORT=4000
DATABASE_URL=postgresql://user:pass@host:5432/callflow
JWT_SECRET=<minimum-32-random-chars>
REDIS_URL=redis://default:password@host:6379
R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
R2_BUCKET=callflow-audio
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
OPENAI_API_KEY=sk-...
WEB_ORIGIN=https://callflow.vercel.app    ← [BUG-51 fix: required for CORS credentials]
```

### `apps/web/.env.local`
```
NEXT_PUBLIC_API_BASE_URL=https://api.maxmusic.in/api/v1
```
Note: JWT_SECRET is NOT needed in the web app — the web frontend never decodes JWTs directly. Cookie parsing is handled by the Express API.

### `apps/ftp-service/.env`
```
FTP_HOST=<korecall-ftp-server-ip>
FTP_PORT=21
FTP_USER=...
FTP_PASSWORD=...
DATABASE_URL=postgresql://...
REDIS_URL=redis://...
R2_ENDPOINT=...
R2_BUCKET=callflow-audio
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
```
No `API_BASE_URL` or `API_SERVICE_KEY` [BUG-12 fix].

### `apps/mobile/.env`
```
API_BASE_URL=https://api.maxmusic.in/api/v1
```

---

## 16. Team Division of Work

### Developer A — Backend + FTP + Mobile

| Task | Files | Week |
|------|-------|------|
| DB migrations 001–003 (locked order), `color_index`, `resolution_status`, source index | `db/migrations/` | 1 |
| Express setup, CORS with `WEB_ORIGIN` + `credentials: true` [BUG-51] | `index.ts` | 1 |
| Auth: JWT, httpOnly SameSite=None cookie for web, body token for mobile [BUG-51] | `auth.routes.ts` | 1 |
| Shared TypeScript types: all fields including `call_stats`, `intercom_phone_number`, `source_label`, `color_index`, split `daily_breakdown` | `packages/shared-types/` | 1 |
| `GET /employees` with `call_stats` via LEFT JOIN aggregate [BUG-45] | `employees.routes.ts` | 2 |
| `GET /employees/names` — both roles, active only [BUG-47] | `employees.routes.ts` | 2 |
| Employees: auto `color_index`, bcrypt [BUG-21, BUG-28] | `employees.routes.ts` | 2 |
| `GET /calls` JOIN: `intercom_phone_number` [BUG-34], `source_label` [BUG-16], `color_index` [BUG-21], `total` [BUG-19]; phone normalization in search [BUG-44]; source filter accepts both `source` and `device_id` [BUG-46] | `calls.controller.ts` | 2 |
| Resolution endpoint [BUG-17] | `calls.routes.ts` | 2 |
| Lines with `call_count_today` [BUG-06] | `lines.routes.ts` | 2 |
| Intercoms with `call_count_total` [BUG-29] | `intercoms.routes.ts` | 2 |
| Devices CRUD + DELETE [BUG-24] + `GET /devices/names` [BUG-09] | `devices.routes.ts` | 2 |
| Students: import + PATCH + DELETE [BUG-05, BUG-25] | `students.routes.ts` | 2 |
| System status [BUG-07] | `system.routes.ts` | 2 |
| `GET /analytics/misc-count` expanded to 4 fields [BUG-53] | `analytics.queries.ts` | 2 |
| `GET /analytics/overview`: `top_line`, resolved/escalated, `day_label`, `mom_delta`, CSAT [BUG-18, BUG-17, BUG-22, BUG-23, BUG-32] | `analytics.queries.ts` | 3 |
| `GET /analytics/employee/:id`: split `daily_breakdown` always current week [BUG-31] | `analytics.queries.ts` | 3 |
| R2, Bull queue, AI worker (Whisper → diarization → summary + sentiment) | services + queue | 3 |
| FTP service: corrected regex [BUG-03], poller, student lookup, system_state update | `apps/ftp-service/` | 4 |
| Mobile: LoginScreen [BUG-02], DeviceSetupScreen + queue indicator [BUG-26], sync null line contract [BUG-20] | `apps/mobile/` | 4 |

### Developer B — Web Dashboard

| Task | Files | Week |
|------|-------|------|
| `lib/constants.ts` — `C` design token object [BUG-52] | `lib/` | 1 |
| `lib/colors.ts` — `eClr(colorIndex % palette.length)` [BUG-50] | `lib/` | 1 |
| `lib/chartTransforms.ts` — `toLineChartData`, `toBarChartData` [BUG-37] | `lib/` | 1 |
| `lib/tagMaps.ts` — `aiStatusTag()` [BUG-40] | `lib/` | 1 |
| `lib/callSentiment.ts` — `callSentiment(call)` using `C` [BUG-48, BUG-35] | `lib/` | 1 |
| `lib/api.ts` — all fetch wrappers with `credentials: 'include'` [BUG-51] | `lib/` | 1 |
| `app/layout.tsx` with DM Sans font [BUG-41] | `layout.tsx` | 1 |
| Next.js scaffold, login page, route protection | app + `middleware.ts` | 1 |
| `Card`, `Tag`, `StatCard`, `Pagination` | `ui/` | 1 |
| `Sidebar.tsx` — dynamic employee nav from `GET /employees/names` [BUG-33, BUG-47] | layout | 1 |
| `Topbar.tsx` — dynamic month label, LIVE indicator [BUG-49] | layout | 1 |
| `CallTable.tsx` — loading skeleton + pagination [BUG-42, BUG-19] | calls | 2 |
| `MobileCallCard.tsx` — uses `callSentiment(call)` [BUG-35] | calls | 2 |
| `CallPanel.tsx` — `intercom_phone_number` [BUG-34], resolution [BUG-17], `aiStatusTag` [BUG-40] | calls | 2 |
| `CallFilters.tsx` — 6 filters (5 for employee), `buildSourceParams`, dynamic from API [BUG-46, BUG-47, BUG-38] | calls | 2 |
| `EmployeeFilterDropdown.tsx` — single combined Agent+Type dropdown [BUG-36] | employees | 2 |
| `WABtn`, `AudioPlayer`, `PieChart`, `LineChart`, `BarChart`, `GaugeMeter` | ui | 2 |
| RecordingsPage — 6/5 filters, `callSentiment`, loading, pagination | recordings | 2 |
| MiscPage — 9 columns, 4 stat cards from expanded `misc-count` [BUG-16, BUG-53] | misc | 2 |
| LinesPage [BUG-06] | lines | 2 |
| IntercomsPage [BUG-29] | intercoms | 2 |
| TeamPage — 5-field modal [BUG-14], `call_stats` from employee response [BUG-45] | team | 3 |
| EmployeePage — two-state machine, `EmployeeFilterDropdown`, `toBarChartData` [BUG-30, BUG-43] | employees | 3 |
| EmpDashPage — date pills, `toBarChartData` (always current week), pagination [BUG-31] | employees/[id] | 3 |
| OverviewPage — CSAT from `team_split` [BUG-32], resolved/escalated [BUG-17], `top_line` [BUG-18], `toLineChartData` [BUG-37], "View all →" to Employees [BUG-39], `mom_delta` [BUG-23] | overview | 3 |
| `lib/api.ts` wrappers | lib | Ongoing |

### Sync Points

| Point | When | What |
|-------|------|------|
| Kickoff | Week 1 Day 1 | Schema, shared types (all new fields including `call_stats`), JWT format, CORS config |
| Integration 1 | End Week 2 | `/calls` + `/lines` + `/intercoms` + `/employees/names` + expanded `misc-count` live → wire Recordings, Lines, Intercoms, Misc pages |
| Integration 2 | End Week 3 | `/analytics/overview` + `/analytics/employee/:id` live → wire Overview, Employees, EmpDash |
| System status | Mid Week 3 | Sidebar footer pills + LIVE indicator end-to-end |
| FTP test | Mid Week 4 | Real KoreCall credentials; verify `intercom_phone_number` in CallRow, regex handles 1-digit intercoms |
| Mobile e2e | End Week 4 | Android call → `line = "—"`, `intercom = "—"` confirmed in dashboard |
| QA | Week 5 | Sentiment shows AI data; Team page shows `call_stats`; MiscPage 4 stat cards populated; Source filter translates correctly; Agent filter hidden for employee role |

---

## 17. Phases & Timeline

### Phase 1 — Foundation (Week 1)
- Monorepo + Docker Compose (Postgres + Redis)
- DB migrations 001–003
- Auth endpoints: httpOnly SameSite=None cookie (web) + body token (mobile) [BUG-51]
- Shared TypeScript types with all new fields (`call_stats`, `intercom_phone_number`, split `daily_breakdown`)
- `lib/` files: `constants.ts` [BUG-52], `colors.ts` [BUG-50], `chartTransforms.ts` [BUG-37], `tagMaps.ts` [BUG-40], `callSentiment.ts` [BUG-48], `api.ts` [BUG-51]
- Shell layout: `Sidebar.tsx` (dynamic nav from `/employees/names`), `Topbar.tsx` (dynamic month) [BUG-49]
- Login page, middleware, DM Sans font [BUG-41]
- `Card`, `Tag`, `StatCard`, `Pagination`

### Phase 2 — Core Data Pages (Weeks 2–3)
- All CRUD endpoints; `GET /employees` with `call_stats` [BUG-45]; `GET /employees/names` [BUG-47]; calls JOIN for `intercom_phone_number` + `source_label` + `color_index`; `buildSourceParams` contract [BUG-46]; expanded `misc-count` [BUG-53]; resolution endpoint [BUG-17]; `call_count_today` [BUG-06]; `call_count_total` [BUG-29]; student import + edit [BUG-25]; device DELETE [BUG-24]; system status [BUG-07]
- `CallTable` + `MobileCallCard` + `CallPanel` + `CallFilters` (with RBAC agent filter) + `EmployeeFilterDropdown`
- All `ui/` chart components
- Recordings, Misc (4 stat cards), Lines, Intercoms, Team pages

### Phase 3 — Analytics + AI (Weeks 3–4)
- `/analytics/overview` with all new fields; `/analytics/employee/:id` with split breakdown
- OverviewPage, EmployeePage (two-state), EmpDashPage, Team page with `call_stats`
- R2 + Bull + AI worker (Whisper → GPT-4o-mini diarization → summary + sentiment)
- Student CSV import

### Phase 4 — FTP + Mobile (Week 4)
- FTP service: corrected regex, poller, student lookup, `system_state` update
- Mobile: API key login, DeviceSetupScreen + offline queue indicator, background sync

### Phase 5 — Integration & QA (Week 5)
- E2E: KoreCall → `intercom_phone_number` in CallRow verified
- E2E: Android → `line = "—"` and `intercom = "—"` in dashboard
- Verify: sentiment shows `😊/😞/😐/⏳/—` from AI data, not duration
- Verify: Team page quick stats populated from `call_stats`
- Verify: MiscPage all 4 stat cards show correct values
- Verify: Source filter correctly sends `source=korecall` vs `device_id={uuid}`
- Verify: Agent filter absent on Recordings page for employee role
- Verify: New employee added via Team page appears in sidebar nav
- Verify: CSAT dropdown shows agents from `team_split`, not hardcoded names
- Verify: Recordings filter shows all 10 lines and all 10 intercoms
- Verify: "View all →" navigates to Employees, not Recordings
- Verify: 9th employee gets a palette color (not `undefined`)
- Rate limiting, error handling (400/401/403/404/500), mobile responsive QA
- Deploy: API on DigitalOcean + PM2, web on Vercel, Supabase, Upstash

---

## 18. Master Bug Index — All Versions

| Bug | Version | Severity | Summary |
|-----|---------|----------|---------|
| BUG-01 | V3 | Critical | `employees.email` column missing |
| BUG-02 | V3 | Critical | Mobile login: email+PIN vs API key |
| BUG-03 | V3 | Critical | FTP regex breaks on 1-digit intercom codes |
| BUG-04 | V3 | Critical | `student_name` missing from schema + API |
| BUG-05 | V3 | Critical | `students` table missing |
| BUG-06 | V3 | Medium | `GET /lines` missing `call_count_today` |
| BUG-07 | V3 | Medium | No endpoint for sidebar status pills |
| BUG-08 | V3 | Medium | LIVE indicator polls undefined endpoint |
| BUG-09 | V3 | Medium | Source filter inaccessible to employees |
| BUG-10 | V3 | Low | WhatsApp button no production implementation |
| BUG-11 | V3 | Critical | Null `audio_storage_key` causes runtime crash |
| BUG-12 | V3 | Medium | FTP service: DB-direct vs API inconsistency |
| BUG-13 | V3 | Low | FTP misc reason is single generic string |
| BUG-14 | V4 | Critical | Add Agent modal missing email, password, role fields |
| BUG-15 | V4 | Critical | Source filter not in design — required for production |
| BUG-16 | V4 | Medium | Misc table missing Source column |
| BUG-17 | V4 | Critical | Resolved/Escalated counts have no backend support |
| BUG-18 | V4 | Medium | Hardcoded "top line" text has no backend support |
| BUG-19 | V4 | Critical | No pagination — data silently truncated |
| BUG-20 | V4 | Medium | Android null line/intercom undocumented |
| BUG-21 | V4 | Critical | Employee color breaks beyond 3 hardcoded names |
| BUG-22 | V4 | Medium | `weekly_activity` format mismatch with LineChart |
| BUG-23 | V4 | Medium | `mom_delta` units ambiguous |
| BUG-24 | V4 | Medium | No DELETE for devices |
| BUG-25 | V4 | Medium | No individual edit/delete for students |
| BUG-26 | V4 | Medium | Android offline queue has no user-facing indicator |
| BUG-27 | V4 | Low | `system_state` migration placement ambiguous |
| BUG-28 | V4 | Medium | Password requirements unspecified |
| BUG-29 | V4 | Medium | Intercoms "Calls" column has no API field |
| BUG-30 | V5 | Critical | EmployeePage two-state architecture undocumented |
| BUG-31 | V5 | Critical | `daily_breakdown` missing inbound/outbound split |
| BUG-32 | V5 | Critical | CSAT gauge: names vs UUIDs, no build strategy |
| BUG-33 | V5 | Critical | Sidebar AGENTS array hardcoded, not dynamic |
| BUG-34 | V5 | Critical | `intercom_phone_number` missing from call responses |
| BUG-35 | V5 | Critical | Sentiment uses duration formula, not AI data |
| BUG-36 | V5 | Medium | EmployeePage filter is combined dropdown, not pills |
| BUG-37 | V5 | Medium | Chart data transform layer not documented |
| BUG-38 | V5 | Medium | Recordings filter options hardcoded partial lists |
| BUG-39 | V5 | Medium | "View all →" goes to Employees, not Recordings |
| BUG-40 | V5 | Medium | `ai_pending` tag variant mapping undefined |
| BUG-41 | V5 | Medium | DM Sans font not specified |
| BUG-42 | V5 | Medium | `CallTable` has no loading/skeleton state |
| BUG-43 | V5 | Medium | Employees page stat cards falsely implied as always visible |
| BUG-44 | V5 | Low | Phone search normalization contract undefined |
| **BUG-45** | **V6** | **Critical** | **Team page quick stats: no API backing — `GET /employees` returns no `call_stats`** |
| **BUG-46** | **V6** | **Medium** | **Source filter mixes `source` type and `device_id` UUID — param translation not documented** |
| **BUG-47** | **V6** | **Medium** | **Recordings Agent filter: `GET /employees` is Owner-only but filter rendered for both roles** |
| **BUG-48** | **V6** | **Low** | **`callSentiment.ts` missing from `lib/` folder structure** |
| **BUG-49** | **V6** | **Low** | **`Topbar.tsx` missing from `components/layout/` folder structure** |
| **BUG-50** | **V6** | **Low** | **`eClr(colorIndex)` no modulo guard — crashes on 9th+ employee** |
| **BUG-51** | **V6** | **Medium** | **JWT cross-origin cookie strategy (SameSite=None + credentials:include) not documented** |
| **BUG-52** | **V6** | **Medium** | **Design token `C` object has no `constants.ts` — lib files have no shared import source** |
| **BUG-53** | **V6** | **Medium** | **MiscPage 4 stat cards backed by only `count` — avg_duration, disconnected, no-response missing** |

---

## Summary of Ownership

**Developer A builds:** All `apps/api/` (35+ endpoints including `GET /employees` with `call_stats` LEFT JOIN, `GET /employees/names`, expanded `misc-count`, updated calls JOIN, CORS with SameSite=None cookie), all `apps/ftp-service/`, all `apps/mobile/`, AI pipeline, R2, Bull, Redis.

**Developer B builds:** All `apps/web/` (8 pages, all components). `lib/` files are the highest priority in Week 1 — they must all be created before any page work: `constants.ts` (design tokens) → `colors.ts` (eClr with modulo) → `callSentiment.ts` → `chartTransforms.ts` → `tagMaps.ts` → `api.ts` (credentials:include). Then Shell layout (`Sidebar` + `Topbar` both with dynamic data). Then pages in order: data pages (Recordings, Misc, Lines, Intercoms) → management pages (Team) → analytics pages (Employees, EmpDash, Overview).

**Total deliverable:** A music school call management system where every recording — KoreCall or Android — appears in a fully paginated, dynamically colored, AI-sentiment-driven dashboard. The Team page shows real per-agent call stats. The MiscPage shows all 4 aggregated stat metrics. The Recordings source filter correctly routes to the right API param. The Agent filter is absent for employee role. All sentiment data comes from AI, not duration guesses. The 100th employee gets a valid color. The JWT works cross-origin without CORS errors. Every lib file imports its design tokens from a single source of truth.
