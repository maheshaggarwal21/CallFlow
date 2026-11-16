# Employee payment flow — the rules (last updated 17 Nov 2026)

Agreed with the client between 15 and 17 Nov 2026 (dated list in §8). This file is the source of truth for how a rep's
monthly pay is worked out. Code: `apps/api/src/lib/payroll.ts` (the pure rules, unit-tested) and
`apps/api/src/services/pay.service.ts` (the one place that gathers the data, `monthPay`). The Employee Tracker, the
Days view and the rep's own dashboard all read the same numbers from that one service, so they can never disagree.

## 1. The month's payout

**Payout = salary earned on working days + commission + extra commissions − deductions**, never below ₹0.

- Paid **after the month ends**. A month stays **open for 10 days** after it ends (late payments dated in it still
  count), then it is **final** (§6).
- The Employee Tracker shows what has been **earned so far** (live, today included) for the running month.
- **Daily pay is Off on the live site** until the client picks the start month (§5). While it is Off, every month
  pays the **full fixed salary** + commission + extras − deductions (the rule used before 15 Nov 2026).

## 2. What counts

### Calls (client, 17 Nov 2026)
- **Every call counts**, for the number of calls and for calling time: incoming and outgoing, short ones (under 10 s),
  and unanswered ones.
- **Calling time** = the sum of the **recording lengths** of all the rep's calls that day — the same number as the
  Talk time card. The length is read from the recording file when it arrives (rounded to the second), so an
  unanswered call counts its ringing time (the PBX records from the moment it dials).
- A call belongs to **whoever held the line when its recording arrived** (usually a minute or two after the call).
  Swapping agents never moves earlier calls; calls after the swap go to the new holder.

### Payments (client, 17 Nov 2026)
- From the school site's payments; the **paid date is the only date** that matters (the only date on the Payments
  tab). A payment counts on its paid date **however late it shows up**: paid date Friday, shows up Sunday → it counts
  for Friday (Friday's commission and Friday's trial target).
- It goes to the **Representative on the school site's payment** ("the name in front of the student").

## 3. Commission

- Fee type **Trial** → the trial rate; **every other fee type** (Class 1, Class 2, renewals…) → the regular rate.
  A renewal earns the **same rate** as a first regular fee.
- `pct` = % of the amount paid; `fix` = ₹ per payment.
- Commission does **not** depend on the targets; a payment dated on a Sunday or holiday still earns it in full.
- It belongs to the month of the paid date, **only** that month (a payment dated 30 Nov is November's).

## 4. Daily salary

### Working days
- One **Working Days** tab (Salary section; whoever has the tab ticked, the Super Admin always), for everyone:
  the **weekly working days** are ticked once (e.g. Mon–Sat); **holidays**: click a date in the month calendar and
  name it; click a holiday to remove it.
- A non-working weekday or a holiday is **not counted at all**: no salary is owed for it and there are no targets.
- **Day salary = fixed monthly salary ÷ number of working days in that month.**
- Leave for one rep only: **not in this version** (§9).

### Targets (client, 17 Nov 2026)
- **Two daily targets per rep: calling time and trial joining**, each with a round **tick beside the target box** on
  the Users form (✓ = counts for daily salary). The regular-joining target was removed; regular joinings still earn
  commission.
- **Trial joining** = payments with fee type Trial filed under the rep that day (by paid date).
- A ticked target set to **0** is treated as not ticked. The % shown is rounded **down**, so it reads 100 % only when
  the target is really met.

### How a working day is paid (client, 17 Nov 2026)
- **No target ticked → the full day.**
- **Any one ticked target met (100 %) → the full day.** If none is met, the **best** one decides:

  | Best result against its target | Day salary paid |
  |---|---|
  | below 50 % | ₹0 |
  | 50 % to under 100 % | ½ day |
  | 100 % or more (any target) | full day |

- The results are **not added together**: two targets at 50 % give ½ day. There is no 75 % step.
- Examples — ₹12,000 salary, 25 working days → ₹480 a day; targets calling 6 h and 2 trials:

  | Calling | Trials | Day salary |
  |---|---|---|
  | 6 h | 0 | ₹480 (calling met) |
  | 1 h | 2 | ₹480 (trials met) |
  | 3 h | 1 | ₹240 (both 50 %) |
  | 5 h | 0 | ₹240 (83 % is still ½) |
  | 2 h | 0 | ₹0 |

- Days saved earlier with the old regular target ticked are worked out the same new way (it is ignored).

### Who is paid which days
- Days **before the rep's Joining date** → ₹0. New users: the date is **filled with today** on Add User (editable);
  older reps: the day their account was made, correctable.
- Days **after the day the rep was switched off** → ₹0; the day itself still counts. Days a rep was switched off and
  then back on are not paid. The history is kept by the nightly day close: one saved row (`day_targets`) per rep who
  was working that day, so a rep off 12th–15th and back on the 16th has no rows for 13–15. (Known gap: if the server
  is down over those nights, the missed days are closed from the rep's status when it comes back; a full switch log
  would close it — §9.)
- **A rep added after they started**: set their **Joining date** to the real first day. The days from then until the
  account was made become working days (₹0 unless targets were met) and the Super Admin clicks **Count as full** on
  them.
- **Count as full**: Employee Tracker → **Days** on the rep's row → orange **Count as full** at the end of each
  working day's row (e.g. the PBX or power was down). Shown as "Full · set by Super Admin"; the button then reads
  **Undo**. Super Admin only; not on Sundays, holidays, future days or in a final month. It appears **only while daily
  pay is on**.

### Targets saved per day
- Each day's **targets and ticks are saved when the day closes** (just after midnight IST), so a target changed on
  the 15th leaves days 1–14 on their old targets; a change during a day applies to that whole day.
- A day's **results are not locked at midnight**: calls and payments keep updating while the month is open (late
  payments, calls moved by the hourly PBX clock fix, calls given to a rep from a free line).

## 5. Switching daily pay on

- **"Daily pay starts from"** on the Working Days tab. Months before it, and every month while it is **Off**, pay the
  full fixed salary. **Start month: still to be decided by the client** (§9). Until it is set, nothing daily shows
  (the Days list, Count as full, the salary line of the targets summary).

## 6. Month close (client, 17 Nov 2026)

- **A month's pay covers the 1st to its last day only** (November = 1–30 Nov). The days of the next month are never
  counted in it: 1–10 Dec are December's salary days.
- **The 10 days after it are only a waiting period for late payments**: November takes late payments **dated in
  November** until **10 Dec** (end of day). From **11 Dec** November is **final**.
- At the close each person's month pay is **saved as it is** (`month_close`); every screen (tracker, Days, dashboard)
  shows that saved copy from then on. A later call, target or salary change can't move it; holidays and Count as
  full are refused in a final month.
- A month **never closes while someone's payments can't be read** (school site down); it tries again on the next run
  (every 10 minutes). Reps not yet linked on the school site don't block it.
- **A payment dated in a final month that shows up after it closed** is **not added anywhere** (it belongs to its
  paid date's month). Once a day the server looks for them in the last 3 closed months and lists them
  (`late_payments`); the Employee Tracker row shows "+1 late payment · ₹X commission, not added", and the Super Admin
  can add it by hand as an extra.
- The tracker shows the state under its title: **"Open until 10 Dec"** or **"Final"**. Months before November 2026 are
  worked out live as before.

## 7. Salary, extras and deductions

### Fixed salary
- The client changes salaries **only on the 1st** of a month, so the fixed salary on the Users form applies to the
  whole month it is in (the form says so under the box). No salary history is kept.

### Extra commissions and deductions
- Paid **once, in the month their start date falls in** (the form fills the start with the day it is added).
- A **% deduction is a % of salary + commission** (extra commissions left out), not of the fixed salary alone. Under
  daily pay that is what has been earned so far, so it grows with the month. A ₹ deduction is taken as written.
- Example: salary ₹12,000 + commission ₹52,100 + extras ₹200; a 10 % deduction = 10 % of ₹64,100 = ₹6,410.

## 8. Where the numbers are shown (all from `monthPay`)

| Screen | Who | What |
|---|---|---|
| Employee Tracker | Super Admin | Per rep: salary ("₹5,280 · 11 of 25 working days"), commission, extras, deductions, total; the month's state (Open until / Final); late payments not added |
| Days (Tracker → Days) | Super Admin | The month day by day: calling and trials against target, share, ₹; Count as full / Undo (daily pay on, month not final) |
| My Dashboard (and the Super Admin's eye) | The rep | The same totals and the same day-by-day list, read-only |

### The rep's dashboard (`apps/web/components/users/UserDashboard.tsx`)
1. **Earnings card** (brown, one card): the month's total in bold with a **● Live** tag, then each part by name —
   fixed salary, trial commission · joinings, regular commission · joinings, each extra (green), each deduction
   (red) — and "Today so far". Inside it on the right: **Yesterday** (that day's salary under daily pay + commission
   on payments dated yesterday), tagged **"Day ended"** because a payment dated yesterday can still arrive. A past
   month reads "Open until 10 Dec: late payments dated this month still count", then "This month has ended: final".
2. **Targets**: one day picked → that day's box (ring red under 50 %, orange from 50 %, green at 100 %; badges
   "met · full day" / "50 %+ · ½ day" / "under 50 %"). A longer period → **"Met on 9 of 12 working days"** per
   target with a dot per day (green met, orange 50 %+, red under 50 %) and, under daily pay, "Salary earned in these
   days ₹… of ₹… possible"; targets are never added up over a period (pay is per day). Up to 3 months.
3. Calls, talk time, real conversations, invalid numbers. 4. **Conversions** (trial and regular joined, commission,
   the payments table). 5. Busiest hours and the call funnel. 6. The **Days** list (daily pay only).
- **Details ▾**: Profile (Reg No., designation, contact, email, line · intercom, calling number) and Salary plan
  (fixed salary, commissions, running extras and deductions; "10% of salary + commission").
- **A switched-off rep**: grey **Inactive** badge; frozen at the leaving day ("Final payout", "Left on …"), only a
  custom range up to that day, no Yesterday panel. Elsewhere they are greyed at the bottom of the Tracker for the
  months they worked, at the bottom of Users (All / Active only / Inactive filter), and out of everyday dropdowns.

## 9. Still open

1. **Start month** for daily pay (1 Nov or 1 Dec 2026).
2. **Leave for one rep** (today holidays apply to everyone).
3. A full **log of every switch on/off** (only matters if the server is down over a night).

## 10. Decisions, by date

| Date | Decision |
|---|---|
| 15 Nov 2026 | Daily salary by working days and ticked targets; Working Days tab; joining date; Count as full; extras paid once in their start month |
| 15 Nov 2026 | % deduction = % of salary + commission, extras left out |
| 16 Nov 2026 | A longer period on the dashboard shows "met on X of Y days", never a summed target; new user's joining date = today |
| 17 Nov 2026 | Two targets (calling, trial); any one met → full day, else the best one (½ from 50 %); 75 % step and regular target removed |
| 17 Nov 2026 | Every call counts (incoming, outgoing, short, unanswered with its ringing time) |
| 17 Nov 2026 | Paid date is the only date for a payment; days are not locked at midnight |
| 17 Nov 2026 | A month stays open until the 10th of the next month, then is final; later payments are listed, not added |
| 17 Nov 2026 | Fixed salary changes only on the 1st; a rep who started before their account: joining date + Count as full |
