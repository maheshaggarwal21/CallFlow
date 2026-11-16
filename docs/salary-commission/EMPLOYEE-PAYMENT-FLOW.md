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
- **Two daily targets per rep** (client, 17 Nov 2026; the regular-joining target was removed): **calling time** and
  **trial joining**, each with a round **tick beside the target box** on the Users form (✓ = counts for daily
  salary). Regular joinings still earn commission; they just don't count for the day salary any more.
- **Calling time** = the sum of the **recording lengths** of **all** the rep's calls that day (short ones too), the same
  number as the Talk time card. The length is read from the recording file when it arrives (rounded to the second),
  so an unanswered call counts its ringing time (the PBX records from the moment it dials). Shown to the second;
  the % shown is rounded DOWN, so it reads 100 % only when the target is really met.
- **Trial joining** = payments with fee type Trial filed under the rep that day (by the school's paid date).
- A ticked target set to **0** is treated as not ticked.

### How a working day is paid (client, 17 Nov 2026)
- **No target ticked → full day salary.**
- Otherwise **any one ticked target met (100 %) → the full day salary.** If none is met, the **best** ticked target
  decides, by steps (the 75 % step was removed):

  | Best result against its target | Day salary paid |
  |---|---|
  | below 50 % | ₹0 |
  | 50 % to under 100 % | ½ |
  | 100 % or more (any target) | full |

- Examples, ₹12,000 salary, 25 working days → ₹480 a day, targets calling 6 h and 2 trials:
  calling 6 h, 0 trials → **₹480**; calling 1 h, 2 trials → **₹480**; calling 3 h, 1 trial → **₹240** (both 50 %,
  not added up); calling 5 h, 0 trials → **₹240** (83 % is still ½); calling 2 h, 0 trials → **₹0**.
- The results are not added together: two targets at 50 % give ½ day, not a full day.
- Days already saved with the regular target ticked are worked out the same new way (the regular target is ignored).

### Who is paid which days
- Days **before the rep's Joining date** (new box on the Users form; existing reps: the day their account was
  created, correctable) → ₹0.
- Days **after the day the rep was switched off** → ₹0. The day itself still counts. Days a rep was switched off
  and then back on are not paid.
- **How the on/off history is kept**: every night just after midnight the day is closed and one row is saved for each
  rep who was working that day (`day_targets`). A rep switched off on the 12th and back on the 16th has no rows for
  13–15, so those days stay unpaid even though the record now just says "active" (checked by the end-to-end test).
  Known gap: if the server is down over those nights, the missed days are closed from the rep's status when it
  comes back. A full log of every switch would close it (offered, not built).
- **"Count as full"**: Employee Tracker → **Days** on the rep's row → orange **Count as full** button at the end of
  each working day's row (e.g. the PBX or power was down and calls were not recorded). Shown as "Full · set by Super
  Admin"; the same button then reads **Undo**. Super Admin only; not on Sundays, holidays or future days. **It only
  appears once daily pay is switched on**: while it is Off the Days view says "Daily pay is not on for this month".

### Freezing and recalculating
- Each day's **targets and ticks are saved when the day closes** (just after midnight IST), so changing a target on
  the 15th leaves days 1–14 on their old targets. A change during a day applies to that whole day.
- The **results** (calls, payments) are **recalculated until month end**, so a call moved by the hourly PBX clock
  fix, calls given to a rep from a free line, or a payment that shows up late still count.
- A payment always counts on its **paid date** (the only date on the Payments tab). If a payment dated the 14th only
  appears on the Payments tab on the 15th, it is added to the **14th**, not to the 15th. The month's total counts
  it once either way.
- *(Question 7, still open: should a finished day be locked at midnight instead? Then such a late payment would earn
  nothing for that day's salary share. Commission is counted for the month either way.)*
- Adding a holiday later in the month changes the month's working days, so "earned so far" can shift a little.

### Extra commissions and deductions
- Paid **once, in the month their start date falls in** (the form fills the start with the day it is added).
- A **% deduction is a % of salary + commission** (extra commissions left out; client, 15 Nov 2026), not of the
  fixed salary alone. Under daily pay that is what has been earned so far, so it grows with the month.
  A ₹ one is taken as written.

## 4. Switching it on

- Setting **"Daily pay starts from"** (Working Days tab). Months before it, and every month while it is **Off**,
  keep the old rule (full fixed salary for the month). **Start month: still to be decided by the client.**

## 5. Where the numbers are shown (all from the same calculation)

| Screen | Who | What |
|---|---|---|
| Employee Tracker | Super Admin | Per rep: salary earned so far ("₹5,280 · 11 of 25 days"), commission, extras, deductions, **total earned so far** |
| Days view (tracker → Days) | Super Admin | The month day by day: calling / trials / regular against target, share, ₹; **Count as full** / Undo (daily pay on only) |
| My Dashboard → Pay card + My days | The rep (and the Super Admin through the eye) | The same totals and the same day-by-day list, read-only |

## 5b. The rep's dashboard (client, 15 Nov 2026)

Top to bottom (`apps/web/components/users/UserDashboard.tsx`; every amount comes from `monthPay`):

1. **Earnings card** (brown, one card):
   - left: **Earned so far** for the month with a **● Live** tag, the total in bold, then each part listed by name:
     fixed salary ("12 of 25 working days" under daily pay), trial commission · joinings, regular commission ·
     joinings, each extra commission (green), each deduction (red), then "Today so far" (today's share of the total);
   - right, inside the card: **Yesterday** — yesterday's total, its salary (daily pay only) and the commission on
     payments with yesterday's paid date. Tagged **"Day ended"**, not "Final", because a payment dated yesterday
     that shows up later is still added to it (see Freezing above).
   - A past month reads "Pay · month" and "This month has ended: final".
2. **Targets**
   - **One day** picked (Today, Yesterday, a custom single day): that day's box — today live, or a finished day with
     its saved targets. The calling ring is **red below 50 %, orange from 50 % and green at 100 %** (the % is rounded
     down). Step badges show only on working days.
   - **A longer period** (Last 7 days, This month, Last month, a custom range; client, 16 Nov 2026): targets are
     **not** added up over the period, because pay is per day and a "100 % week" could hide ₹0 days. Instead, for
     each ticked target: **"Met on 9 of 12 working days"**, a bar, and one dot per working day (green met, orange
     50 %+, red under 50 %). Under daily pay also **"Salary earned in these days ₹… of ₹… possible"**. Each
     day uses the targets it had; Sundays, holidays and days before joining or after leaving don't count. Same
     per-day results as the Days list (`periodTargets` in `pay.service.ts`; a month not on daily pay is worked out
     with a preview calendar, nothing saved). Up to 3 months; longer asks for a shorter period.
3. Calls, talk time, real conversations, invalid numbers.
4. **Conversions** — trial joined · commission and regular joined · commission, then the payments table (each
   payment's fee is in the table; the separate fees total was removed at the client's request).
5. Busiest hours and the call funnel side by side.
6. The **Days** list (daily pay only).

**Details ▾** opens two lists side by side: **Profile** (Reg No., designation, contact, email, line · intercom,
calling number) and **Salary plan** (fixed salary, trial and regular commission, each running extra and deduction;
a % deduction reads "10% of salary + commission").

**A switched-off rep** shows a grey **Inactive** badge, and the dashboard is frozen at the day they left: it opens on
the leaving month up to that day and the card reads **"Final payout"** with "Left on …"; only a custom range up to the
leaving day can be picked; there is no Yesterday panel; the targets box shows only when one day on or before the
leaving day is picked.

The whole site works on a phone: below 900 px the sidebar becomes a ☰ menu, cards stack, and wide tables scroll
sideways inside their own card.

## 5c. Switched-off staff elsewhere (client, 15 Nov 2026)

- **Employee Tracker**: greyed, at the bottom, tagged "Left 10 Nov", only for the months they worked.
- **Users**: at the bottom; the **All users / Active only / Inactive (n)** dropdown narrows the list.
- Everyday dropdowns (agents, reports) list active people only.

## 6. Still open

1. **Start month** for daily pay (1 Nov or 1 Dec 2026). Until it is set nothing daily shows, including Count as full.
2. **Question 7**: lock a finished day at midnight, or keep counting late results until month end (current)?
3. **Leave for one rep** (today holidays apply to everyone).
4. A full **log of every switch on/off** (only matters if the server is down over a night; see "Who is paid which days").

Decided on 15 Nov 2026: % deduction = % of salary + commission (extras left out); inactive staff as in 5c; dashboard
as in 5b.
