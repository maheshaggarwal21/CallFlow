# Employee Tracker, commission setup and the user dashboard: what is built (14 Nov 2026)

Written for an AI or developer picking this up cold. `DESIGN.md` in this folder is the **older plan**
(10 Nov: a separate Commission Setup page, a `payments` table, `commission_entries`). Most of that plan
was **not** built. This file describes the code as it is now.

Status: branch `feature/access-salary`, **localhost only, not committed, not deployed**. Local DB is
Postgres on 127.0.0.1 (the scripts refuse any other host). `apps/api/.env` points at the remote
Supabase DB, so never run plain `migrate.ts` against it. Use `npm run crm:migrate`.

---

## 1. The idea in one paragraph

The school owner (Super Admin) sets each rep's pay on the **Users form**: fix salary, trial
commission, regular commission, an "other" amount, then any number of **extra commissions**
(bonus ₹ for a date range) and **extra deductions** (₹ or % of fix salary for a date range).
Two screens show pay. The **Employee Tracker** (`/dashboard/salary`, Super Admin only) has one row
per active rep and a team total. Its eye button opens **that rep's dashboard as the rep sees it**.
**My Dashboard** (`/dashboard/me`) is each User's home: profile, salary plan, today's targets,
calls and earnings. There is **no separate Commission Setup tab any more**: it was merged into the
Users form on 13 Nov.

## 2. Where the money comes from (14 Nov: payments connected)

| Figure | Source |
|---|---|
| Fix salary, trial/regular rate and type, other amount, extras, deductions | `employees` columns, set on the Users form |
| Fees collected, trial and regular commission | The school site's partner API, `GET /api/v1/partner/payments` (see §4a) |
| Calls, talk time, hourly chart, funnel | `GET /reports/data` (call records) |

The sample ledger (`lib/salarySample.ts`, invented students) was **deleted** on 14 Nov. Without
`PAYMENTS_API_URL`/`PAYMENTS_API_KEY` the screens say "not connected" and commission is ₹0.

### Pay rules (`apps/api/src/lib/payroll.ts`, unit-tested in `payroll.test.ts`). Our assumptions, still to confirm with the client:
- A payment whose `feeType` is "Trial" earns the **trial** rate; **every other** fee type earns the
  **regular** rate. So a rep earns again on each later monthly fee they enter (recurring commission),
  credited to the rep the school site files it under (`callFlowId`).
- `pct` = % of the amount paid; `fix` = ₹ per payment.
- Monthly payout (Employee Tracker, and "Pay · <month>" on My Dashboard, same function `monthPayout`) = fix salary + other amount + commission + extra commissions
  whose dates overlap the month − deductions whose dates overlap the month (a % deduction is a % of
  the fix salary), never below ₹0. Each extra or deduction counts **once per month** it overlaps.
- My Dashboard's Earnings card shows the commission for the picked period, plus the monthly salary
  and the extras/deductions active today as separate lines.

## 3. Data model (`employees` table)

Added by migration `016_access.sql`, plus `019_extra_deductions.sql`:

| Column | Type | Meaning |
|---|---|---|
| `fix_salary` | INTEGER ₹ | Monthly fixed salary |
| `trial_commission` | NUMERIC | Rate per trial joining |
| `trial_commission_type` | `'fix'` \| `'pct'` | `fix` = ₹ each; `pct` = % of the fee |
| `regular_commission` | NUMERIC | Rate per regular joining |
| `regular_commission_type` | `'fix'` \| `'pct'` | as above |
| `other_amount` | INTEGER ₹ | A flat extra added to the monthly salary |
| `target_call_secs`, `target_trial`, `target_regular` | INTEGER | Daily targets shown on the dashboard |
| `extra_commissions` | JSONB array | `[{ name, amount, from, to }]` |
| `extra_deductions` | JSONB array | `[{ name, type, amount, from, to }]` |

JSON shapes (TypeScript, `packages/shared-types/src/index.ts`):

```ts
type ExtraCommission = { name: string; amount: number; from: string; to: string };   // ₹ bonus, dates YYYY-MM-DD (IST)
type ExtraDeduction  = ExtraCommission & { type: "fix" | "pct" };                     // fix = ₹, pct = % of fix_salary
```

- Both are validated on the API by zod (`extraSchema`, `deductionSchema` in
  `apps/api/src/routes/employees.routes.ts`): name 1–60 chars, amount 0–10,000,000, `from <= to`,
  a `pct` deduction at most 100, at most 20 of each per user. Unknown keys are stripped.
- Error messages name the item: `Extra deduction 2: The end date is before the start date`.
- Migration 019 rewrote older extra commissions, which had `counts`, `reward`, `target`, `days`
  and `hours` (a rules engine the client dropped), down to `{name, amount, from, to}`.
- "Active" means `from <= today (IST) <= to`. Status shown on the form: Scheduled / Active / Ended.

## 4a. The school's payments API (built by the school site's developer)

`GET {PAYMENTS_API_URL}/api/v1/partner/payments?callFlowId=<employees.id>&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&page=1&limit=100`,
header `x-api-key`. Production `PAYMENTS_API_URL=https://maxmusicschool.in` (found 14 Nov in the school site's own JS; answers 401 without a key, 404 "No user found for this callFlowId" for a rep the school site hasn't linked). Each rep must have their CallFlow `employees.id` saved on the school site. Client: `apps/api/src/services/payments.service.ts`.
- Reads every page (limit 100, at most 20 pages = 2,000 payments per rep per period, else an error).
- Checks every answer with zod; keeps only id, student name, amountPaise, paidDate, paymentMode,
  feeType, linkedTo, receiptUrl (**https only**; anything else becomes null). Student email and phone
  are dropped and never reach the browser.
- 15 s timeout, no redirects, https required in production, results cached 2 minutes per rep and range.
- On failure it throws `PaymentsError`; the routes then show "couldn't load" and keep the rest of
  the page working. Their reply body is logged on the server only, with the key masked.
- Local tests use `apps/api/scripts/mock-payments.mjs` (key `mock-key`, port 4100).

## 4. API

All routes are under `/api/v1/employees`, behind `requireAuth`.

| Route | Who | What |
|---|---|---|
| `GET /` , `POST /`, `PATCH /:id` | Users tab permission | List, create, edit users, including all salary fields and both JSON arrays |
| `GET /:id` | owner/admin, or the user themself | One user's record |
| `GET /me/summary?date_from&date_to` | any signed-in user | Their own dashboard data |
| `GET /:id/summary?date_from&date_to` | **Super Admin (`owner`) only**; others get 403; a non-uuid id gets 404 | The same data for any user. Used by the tracker's eye |
| `GET /payroll?month=YYYY-MM` | **Super Admin only** | Every active User's month payout: `trial`/`regular` {count, fees, commission}, base, other, extras[], deductions[], total, and `error` if their payments didn't load |

The summary response is the employee columns above, plus line, intercom and calling number, plus:
```
today:  { call_secs, trial, regular }
income: { joinings, trial, regular, total, trial_count, regular_count, fees }   // from payments, picked period
payments: { connected, error, list: [{ id, name, paid_date, mode, fee_type, linked_to, amount, commission, trial, receipt_url }] }
```
`today.trial` / `today.regular` = trial and non-trial payments collected today (IST).

Ranks are stored as `owner` / `admin` / `employee`; the screens call them Super Admin / Admin / User.

## 5. Web screens

### Users form: `apps/web/app/dashboard/users/page.tsx`
Sections in order: Basic → Salary (Fix Salary, Trial Commission, Regular Commission, Add Other
Amount) and Call Setting, Target → **Extra Commission** → **Extra Deduction** → Tabs.
- Both extra sections use one component, `apps/web/components/users/ExtraCommissions.tsx`; pass
  `deduction` for the minus version. Each item is a card with Edit / Remove. Adding opens a small
  form:
  - Extra commission: *Name of extra commission*, *Amount (₹)*, *Active from*, *Active to*.
  - Extra deduction: *Name of deduction*, *Deduct as* (Fixed amount ₹ / % of salary), *Amount*
    or *Percent*, *Active from*, *Active to*. The add button is red with a "−" sign.
- Items are kept in form state and saved with the whole form on **Save** (PATCH/POST).
- Helpers exported from that file: `isActive`, `amountText`, `deductionValue(x, fixSalary)`,
  `extraText`, `extraProblem` (the same checks as the server, so errors show before Save).

### Employee Tracker: `apps/web/app/dashboard/salary/page.tsx` (Super Admin only)
- Other ranks are redirected to their home (`/dashboard/me`).
- Month dropdown (this month and the 11 before). Data: `GET /employees/payroll?month=`.
- Active Users (`role = employee`, `status = active`): stat cards (total payout, commission, fees
  collected, top earner), then one row per rep (trial count + commission, regular count + commission,
  extras, deductions, salary + other, total payout), best total first. Hover extras/deductions for
  each item. Banners for "not connected" and for reps whose payments didn't load.
- The **eye ("View") button** (`EyeButton` in `components/salary/kit.tsx`) links to
  `/dashboard/salary/[id]`. That page renders `UserDashboard id={id}`: the rep's own dashboard,
  titled "<Name>'s Dashboard · As this user sees it", with a back link. The old sample "salary
  breakdown" page with a fake student ledger was **deleted** on 13 Nov.

### My Dashboard / the rep's dashboard: `apps/web/components/users/UserDashboard.tsx`
- `/dashboard/me` renders `<UserDashboard />` for the signed-in user. The tracker's eye renders
  `<UserDashboard id=… />` for a chosen user. Without `id` it calls `/employees/me/summary` and
  `/reports/data?employee_id=all` (the API narrows a User to their own data); with `id` it calls
  `/employees/:id/summary` and `/reports/data?employee_id=:id`.
- Left card: profile, then the salary plan (fix salary, trial and regular rates, other amount),
  then **"Active now"**: each active extra commission (`+ name · ₹ · till date`, orange) and each
  active deduction (`− name · −₹value (x%) · till date`, red). A % deduction is shown as ₹ using
  `fix_salary`.
- Right side: today's targets (calling-time donut, trial and regular progress), call tiles, hourly
  chart, the **Earnings** card, **Fees collected** (the period's payments: date, student, fee type,
  mode, amount, commission, receipt link; 25 at a time), and the funnel. The Earnings card's big
  number is the period's commission; below it trial and regular commission with counts, fix salary +
  other per month, a `+₹` line per active extra and a `−₹` line per active deduction.

## 6. Known gaps / next steps

1. The pay rules in §2 are our assumptions; the client and the school developer must confirm them
   (fee types, who gets renewal credit, refunds, IST dates, extras once per month).
2. No `studentId` from the school site yet, so we can't tell a student's first regular fee
   (admission) from later renewals, or credit renewals to the rep who converted the student.
3. The payments API takes one rep per request; the tracker makes one request per rep (4 at a time).
4. Production: `deploy-crm/enable-payments.sh` (outside the repo) writes `PAYMENTS_API_URL` + `PAYMENTS_API_KEY` to the droplet. Until the school site saves each rep's CallFlow ID, every rep shows "isn't linked on the school site yet".

## 7. How to run and check (local)

```
cd apps/api && npm run crm:migrate   # local DB only; applies 016…019
PAYMENTS_API_URL=http://127.0.0.1:4100 PAYMENTS_API_KEY=mock-key npm run crm:dev   # in apps/api; API on :4000 against the mock (restart after API changes; login limit 20 per 15 min)
cd apps/web && npm run dev           # web on :3000
cd apps/api && npm run crm:e2e       # 71 checks; starts the payments mock itself
cd apps/api && npm run build && node --test dist/lib/payroll.test.js
cd apps/web && npm run type-check    # the real type gate (next build ignores type errors)
```
Demo logins are seeded with `@crm-demo.local` emails (`npm run crm:seed`); the owner is `owner@crm-demo.local`.

## 8. File map

| Concern | File |
|---|---|
| Columns | `apps/api/src/db/migrations/016_access.sql`, `019_extra_deductions.sql` |
| Validation, summary and payroll routes | `apps/api/src/routes/employees.routes.ts` |
| Shared types | `packages/shared-types/src/index.ts` (`Employee`, `ExtraCommission`, `ExtraDeduction`) |
| Users form | `apps/web/app/dashboard/users/page.tsx` |
| Extra commission / deduction UI + helpers | `apps/web/components/users/ExtraCommissions.tsx` |
| Rep dashboard (also the tracker's eye) | `apps/web/components/users/UserDashboard.tsx`, `apps/web/app/dashboard/me/page.tsx`, `apps/web/app/dashboard/salary/[id]/page.tsx` |
| Employee Tracker | `apps/web/app/dashboard/salary/page.tsx`, `apps/web/components/salary/kit.tsx` |
| Pay rules | `apps/api/src/lib/payroll.ts` (+ `payroll.test.ts`) |
| Payments client | `apps/api/src/services/payments.service.ts`, mock `apps/api/scripts/mock-payments.mjs` |
| ₹ format | `apps/web/lib/money.ts` |
| End-to-end checks | `apps/api/scripts/access-e2e.mjs` |
