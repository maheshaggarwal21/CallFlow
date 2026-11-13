# Salary, commission and roles: system design

> **Older plan.** What is actually built (13 Nov 2026) is in [CURRENT-STATE.md](CURRENT-STATE.md); read that first.

Status: design, 10 Nov 2026. Nothing here is in production. Foundation on branch
`feature/access-salary` (local, uncommitted): `apps/api/src/lib/access.ts`, its test, and
migration `016_access.sql`.

## 1. What the client asked for

1. **My salary** page for each employee: trial and regular students converted, the commission on
   each, fixed base salary, total payout for the month up to today.
2. **Recurring commission**: the rep who got a student to join keeps earning on every later fee
   payment for as long as the student stays.
3. **Employee commission setup** page (owner side): per-employee trial and regular rates,
   editable any time, plus a "+" to add a named extra commission for a day or a period.
4. **Payment data** comes from the school's own site, where paid fees are entered daily with the
   rep's name.
5. **Roles** change from owner / employee to user / admin / super admin, with permissions:
   each role has defaults, and individual people can be given extras.

## 2. How the pieces fit

```
School site "Payments"            CallFlow API                         CallFlow web
(sender: webhook or script) ──►  POST /payments/ingest  ──► payments ──► commission_entries
                                  (secret, idempotent)        │              ▲        │
                                  nightly reconcile ◄─────────┘              │        ├─► My salary (employee)
                                                         students.converted_by        ├─► Commission setup (owner)
                                                         commission_plans / extras ───┘   └─► track record per employee
Every page and endpoint ──► requirePermission(key) ──► role defaults + personal add-ons
```

Three independent parts, built in this order: roles and permissions, payment intake, commission.

## 3. Getting the payment data

### What I found
- `maxmusicschool.com` is a **Wix** site with Bookings, Pricing Plans, eCommerce, a Members area
  and custom code (Velo) switched on.
- `maxmusicschool.co.in` is a separate custom-built site (Hostinger).
- I can't see the "Payments" section (it is behind a login), so I don't know which of the two it
  is on, or whether the rep's name is typed by hand or picked from a list. **This is the one
  thing that blocks the intake build.**

### The design that works whichever it is
CallFlow gets one receiving endpoint, the same shape as the lead-sheet sync that already runs in
production (`/crm/ingest`): a shared secret in a header, batches, each record carrying the
site's own payment ID so a repeat is ignored, and a nightly count check that emails OK or
MISMATCH. Only the small sender differs:

| Where the Payments section lives | Sender |
|---|---|
| Wix, real online payments (Pricing Plans / eCom) | Wix Automation "payment received → send HTTP request", or a Velo backend event. No rep name on these, so the rep comes from the CRM lead (see 4.2). |
| Wix, a table staff fill in (CMS collection) | Velo data hook on that collection: after insert/update, POST the row. |
| The custom `.co.in` site | A few lines in its "save payment" code posting to CallFlow, or a read-only API CallFlow pulls every few minutes. Needs that site's developer. |
| Really a Google Sheet behind the page | Copy of `LeadSync.gs` pointed at the payments tab. Already proven. |

A webhook alone loses records when either side is down, so every option also gets a **catch-up**:
the sender retries unsent rows hourly and the nightly check compares counts per day.

### Record sent per payment
`external_id` (payment ID on the site), `paid_at`, `student_external_id`, `student_name`,
`phone`, `amount`, `kind` (trial / regular), `representative` (name or email), `course`,
`status` (paid / refunded).

## 4. Data model

### 4.1 Tables (migration 017, written once the source is confirmed)

- **students** (exists: name, phone): add `external_id`, `converted_by` (employee),
  `converted_at`, `trial_by`. This is the "attach the student to the rep" idea.
- **payments**: `external_id` UNIQUE, `student_id`, `phone10`, `amount`, `kind`, `paid_at`,
  `reported_rep_id`, `status`, `raw` (the record as received).
- **commission_plans**: `employee_id`, `base_salary`, `trial_type` (fixed ₹ / %), `trial_value`,
  `regular_type`, `regular_value`, `renewal_type`, `renewal_value`, `effective_from`,
  `created_by`. A rate change **adds a row**; it never edits the old one.
- **commission_extras** (the "+" button): `name`, `basis`, `value`, `starts_at`, `ends_at`,
  `employee_ids` (empty = everyone), `created_by`.
- **commission_entries** (the ledger): `employee_id`, `payment_id`, `student_id`, `kind`
  (trial / regular / renewal / extra / adjustment), `basis_amount`, `rate_text` (e.g. "12%"),
  `amount`, `earned_at`, `extra_id`. UNIQUE (`payment_id`, `kind`, `extra_id`).

### 4.2 Rules when a payment arrives (one transaction)

1. Insert the payment; if `external_id` exists, stop (duplicate).
2. Find or create the student by `external_id`, else by 10-digit phone.
3. **Who earns it**
   - Trial payment: the rep named on the payment → `students.trial_by`.
   - First regular payment: the rep named on the payment → `students.converted_by`. If the site
     gives no rep, fall back to the CRM lead's "Assigned to" for that phone.
   - Any later regular payment: always `students.converted_by`, whoever is named on it. This is
     the recurring commission; it ends by itself when the student stops paying.
4. Write the ledger entry using the plan **in force on `paid_at`**, storing the rate used.
5. Add one entry per active extra commission that matches.
6. If the phone matches a CRM lead, mark it converted (closes the loop with the Leads page).
7. Refund → a negative entry against the original; nothing is deleted.

### 4.3 Why a ledger
The salary page is `base salary + SUM(entries this month)`. Because each entry stores the rate it
was calculated with, editing a rate changes **future** payments only; last month's figures never
move, and every rupee on the page can be traced to a payment.

### 4.4 Extra commission: the basis question
Yes, it needs a basis, otherwise "extra 5" means nothing. Offer four, picked from a dropdown:

| Basis | Example |
|---|---|
| ₹ per trial conversion | "Diwali push: +₹100 per trial, 12–14 Nov" |
| ₹ per regular admission | "+₹500 per admission this week" |
| % of regular fees collected | "+2% on fees, December" |
| ₹ once a target is reached | "₹2,000 for 10 admissions between two dates" |

Each has a name, start and end, and applies to everyone or chosen employees. It shows on every
affected salary page as its own line with its name.

## 5. Roles and permissions

### 5.1 Model
- Roles: **user**, **admin**, **super admin**. Today's owner becomes super admin, employees
  become users, admin is new.
- A fixed list of permissions (13, in `lib/access.ts`), grouped Calls / Leads / Salary / Admin.
- **Effective permissions = the role's set + personal add-ons − personal take-aways.**
  A super admin always has everything, so the last one can't be locked out.
- The role's set starts from built-in defaults; the super admin can change it in Settings
  (`role_permissions`). Personal changes are ticked in Team → Edit (`employee_permissions`,
  which already exists, gains `effect` grant/deny).

The client's example: Shivani is an admin. Admin has `commission_view` by default, not
`commission_edit`. The super admin can tick `commission_edit` for Shivani alone, or add it to
the admin role for all admins. Both paths are covered by the test in `access.test.ts`.

### 5.2 What changes in the code
- Today access is decided in ~84 places across 25 files by `role === "owner"` or `requireOwner`.
  Each becomes `requirePermission("<key>")`, which already exists for the CRM and reads the
  database on every request, so a change applies at once without a re-login.
- "Employees see only their own calls" becomes: without `calls_all`, filter to own calls.
- `/auth/me` returns the effective permissions; the sidebar and pages show what they allow.
- Team page: role dropdown (3 roles) + permission ticks. Settings: a "Roles" section with the
  role × permission grid, visible with `access_manage`.
- Cost: one extra database trip per request (110 ms while the database is in Tokyo). Cache the
  result in memory for 30 s if it shows.

### 5.3 Rollout without breaking logins
1. Migration 016 (additive, done locally): new role names allowed alongside the old ones.
2. Swap the checks to permissions while `owner` and `employee` still work (`normalizeRole`).
3. Rename the stored roles in one statement, then drop the old names.
Existing sessions keep working throughout because permissions are read from the database, not
the login token.

## 6. Pages

- **My salary** (needs `salary_own`; `salary_all` to open anyone's): four cards (trial, regular,
  base salary, total payout to date), Monthly / Custom range, the converted-students table with
  today's on top, Export. The header call stats in the mock come from existing call data.
- **Commission setup** (`commission_view` to see, `commission_edit` to change): rates form,
  table of current rates, "+ Extra commission", and each row opens that employee's salary page
  (the "track record").
- **Payments** (owner check screen, phase 2): the raw list as received, to compare with the site.

The two mocks disagree: the salary page shows regular as ₹2,000 per admission, the setup page as
12% of tuition. The plan supports both (fixed ₹ or %), per employee.

## 7. Build order

| Phase | What ships | Depends on |
|---|---|---|
| 1 | Roles and permissions across the whole app; Team and Settings screens | Client confirms the default permissions per role |
| 2 | Payment intake + Payments check screen, running silently for a week against the site | Which site, and access to it |
| 3 | Commission setup + My salary | Rate rules confirmed (section 8) |
| 4 | Extra commissions, export, refunds, adjustments | Phase 3 in use |

## 8. Decisions needed from the client

1. Where is the Payments section (Wix or the .co.in site), who maintains it, and how is the rep
   recorded there?
2. Trial commission: fixed ₹ per trial? Regular: fixed ₹ per admission, or % of fees?
3. Recurring commission: same rate as the first payment or a lower "renewal" rate? Forever, or
   capped (e.g. 12 months)?
4. If the rep leaves the school, who gets their students' recurring commission? Nobody, or
   reassigned?
5. Trial by one rep, regular admission by another: trial commission to the first, regular to
   the second?
6. Does a refund take the commission back?
7. Old students: do existing students get attached to reps (needs a one-time list), or only
   those who join after go-live?
8. Who is super admin, who is admin, and are the default permissions in `lib/access.ts` right?
9. Is the salary page the official payslip figure, or an estimate until the owner approves it?
