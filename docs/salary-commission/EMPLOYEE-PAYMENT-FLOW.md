# Employee payment flow — decisions (15 Nov 2026)

Agreed with the client on 15 Nov 2026. This file is the source of truth for how a rep's monthly pay is worked out.
Code: `apps/api/src/lib/payroll.ts` (pure rules, unit-tested) and `apps/api/src/services/pay.service.ts` (the one
place that gathers the data). The Employee Tracker, the Days view and the rep's own dashboard all read the same
numbers from that one service, so they can never disagree.

## 1. The month's payout

**Payout = salary earned on working days + commission + extra commissions − extra deductions**, never below ₹0.
Paid at the **end of the month**. The Employee Tracker shows what has been **earned so far** (live, today included).

## 2. Commission (unchanged)

- Goes to the **Representative on the school site's payment** ("the name in front of the student").
- Fee type **Trial** → trial rate; **every other fee type** (Class 1, Class 2, renewals…) → regular rate.
  A renewal earns the **same rate** as a first regular fee.
- `pct` = % of the amount paid; `fix` = ₹ per payment.
- Commission does **not** depend on the targets, and payments made on a holiday still earn it.

## 3. Daily salary (new)

### Working days
- One **Working Days** tab (its own tab in the Salary section; open to whoever has the tab ticked, the Super Admin always), for everyone:
  - the **weekly working days** are ticked once (e.g. Mon–Sat) and stay until changed;
  - **holidays**: click a date in the month calendar and give it a name; click a holiday to remove it.
- A non-working weekday or a holiday is **not counted at all**: no salary is owed for it and there are no targets.
- **Day salary = fixed monthly salary ÷ number of working days in that month.**
- Leave for one rep only: **not in this version** (later).

### Targets
- Three daily targets per rep: **calling time**, **trial joining**, **regular joining**, each with a round
  **tick beside the target box** on the Users form (✓ = counts for daily salary).
- **Calling time** = the sum of the **recording lengths** of **all** the rep's calls that day (short ones too), the same
  number as the Talk time card. The length is read from the recording file when it arrives (rounded to the second),
  so an unanswered call counts its ringing time (the PBX records from the moment it dials). Shown to the second;
  the % shown is rounded DOWN, so it reads 100 % only when the target is really met.
- **Trial joining** = payments with fee type Trial filed under the rep that day (by the school's paid date).
- **Regular joining** = every other payment that day: **new regular students and renewals**.
- A ticked target set to **0** is treated as not ticked.

### How a working day is paid
- **No target ticked → full day salary.**
- Otherwise **each ticked target is an equal share** of the day (2 ticked = ½ each, 3 ticked = ⅓ each), and each
  share is paid by steps:

  | Result against the target | Share paid |
  |---|---|
  | below 50 % | ₹0 |
  | 50 % to under 75 % | ½ |
  | 75 % to under 100 % | ¾ |
  | 100 % or more | full (no extra above 100 %) |

- Example: ₹12,000 salary, 25 working days → ₹480 a day. Calling 100 %, trials 50 %, regular 0 % →
  ₹160 + ₹80 + ₹0 = **₹240**.
- Small targets are fine as they are (a target of 2 trials can only give 0 %, 50 % or 100 %).

### Who is paid which days
- Days **before the rep's Joining date** (new box on the Users form; existing reps: the day their account was
  created, correctable) → ₹0.
- Days **after the day the rep was switched off** → ₹0. The day itself still counts. Days a rep was switched off
  and then back on are not paid.
- **"Count as full"**: in the Days view the Super Admin can mark a day as full (e.g. the PBX or power was down and
  calls were not recorded). It is shown as "Full (set by Super Admin)" and can be undone.

### Freezing and recalculating
- Each day's **targets and ticks are saved when the day closes** (just after midnight IST), so changing a target on
  the 15th leaves days 1–14 on their old targets. A change during a day applies to that whole day.
- The **results** (calls, payments) are **recalculated until month end**, so a late-recorded payment, a call moved by
  the hourly PBX clock fix, or calls given to a rep from a free line still count. *(Client's question 7 — whether a
  closed day should ever change — is still open; this is the current behaviour.)*
- Adding a holiday later in the month changes the month's working days, so "earned so far" can shift a little.

### Extra commissions and deductions
- Paid **once, in the month their start date falls in** (the form fills the start with the day it is added).
- A **% deduction is a % of the full fixed monthly salary**; a ₹ one is taken as written.

## 4. Switching it on

- Setting **"Daily pay starts from"** (Working Days tab). Months before it, and every month while it is **Off**,
  keep the old rule (full fixed salary for the month). **Start month: still to be decided by the client.**

## 5. Where the numbers are shown (all from the same calculation)

| Screen | Who | What |
|---|---|---|
| Employee Tracker | Super Admin | Per rep: salary earned so far ("₹5,280 · 11 of 25 days"), commission, extras, deductions, **total earned so far** |
| Days view (tracker → Days) | Super Admin | The month day by day: calling / trials / regular against target, share, ₹; **Count as full** / Undo |
| My Dashboard → Pay card + My days | The rep (and the Super Admin through the eye) | The same totals and the same day-by-day list, read-only |

## 5b. The rep's dashboard (client, 15 Nov 2026)

Top to bottom: **Earned so far** this month (salary, commission, extras, deductions) with **Today** (live) and
**Yesterday** (final) cards → **targets** (today live, or a closed day with its saved targets, marked final) → calls,
talk time, real conversations, invalid numbers → **conversions** (trial and regular joinings with the fees) →
busiest hours and the call funnel side by side → the **Days** list. Profile and salary plan sit behind **Details ▾**.
A switched-off rep shows a grey **Inactive** badge. Every amount comes from `monthPay`.

## 6. Still open

1. Start month (1 Nov or 1 Dec 2026).
2. Question 7: should a closed day ever change after it closes?
3. Leave for one rep.
4. Redesign of the rep's dashboard (later; the numbers stay from the same calculation).
