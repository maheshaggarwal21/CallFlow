# Salary & commission: questions for the client

Answers drive the build. Grouped by topic; the ones marked **(blocks build)** stop a phase until
answered. Everything else has a sensible default we'll assume if we don't hear back.

## A. Where the payment data comes from  (blocks payment feed)

1. The Payments tab shows both Razorpay and direct-UPI payments. Is **every** fee eventually
   entered there, so the tab is the one complete record? (If some cash/UPI never gets entered,
   that commission can't be paid.)
2. Who maintains and can deploy the school's backend (the `maxmusicschoolservices` code)? We need
   ~25 lines added there to send each saved payment to CallFlow.
3. Can you send a screenshot of the Payments tab, with its columns? We have the backend code but
   not the admin screens.
4. In that tab, how is the representative shown for each payment — a typed name, or picked from a
   list? (Typed names vary in spelling and need mapping to each CallFlow employee once.)

## B. Commission rates  (blocks commission build)

5. **Trial student:** a fixed ₹ per converted trial? What amount?
6. **Regular student:** a fixed ₹ per admission, or a % of the fee collected? The two mock screens
   disagree (one shows ₹2,000 per admission, the other 12% of tuition). The system supports both,
   per employee — which is the real rule?
7. Are rates the **same for every rep**, or different per rep (the setup page allows per-rep)?

## C. Recurring commission  (blocks commission build)

8. The rep who got a student to join keeps earning on that student's later payments. At the
   **same rate** as the first payment, or a **lower renewal rate**? What rate?
9. Does it run **forever** while the student learns, or stop after a cap (e.g. 12 months)?
10. If a rep **leaves the school**, who gets their students' future commission — nobody, or
    reassigned to someone?
11. If one rep does the **trial** and a different rep does the **regular admission**, who earns
    what?

## D. Edge cases

12. Does a **refund** take back the commission already counted?
13. **Existing students** (already enrolled before go-live): do they get attached to a rep so their
    renewals earn commission? That needs a one-time list of student → rep. Or do we only start
    counting students who join after go-live?
14. Is the salary page the **official payslip figure**, or an **estimate** the owner approves
    before it's final?

## E. Extra commissions (the "+" button)

The builder supports: who (everyone / chosen reps) · what counts (trials / admissions / fees) ·
when (dates, and optionally days of week + hours) · reward (₹ each / % of fees / ₹ at a target /
₹ per one beyond a target).

15. Confirm those cover what you need. Anything missing (e.g. a **team** target shared across all
    reps, or a **race** where the first to a target wins)? Those aren't in v1 but can be added.
16. For **hour-based** rules ("between 6–9 pm"): the Razorpay/UPI time is when the payment was
    *entered*, which may be hours after the sale. Should hour rules instead use the time the rep
    **marked the lead as joined** in CallFlow's Leads page? (More accurate to the rep's actual work.)

## F. Roles & permissions  (blocks the roles revamp, separate from salary)

17. Who is **super admin** (full control, today's owner), and who are **admins**?
18. Default permissions per role — confirm the starting split:
    - **User (rep):** work on leads, see own salary.
    - **Admin:** everything a user has + see all calls, export leads, see all salary pages, see the
      commission page (but **not** edit rates until granted).
    - **Super admin:** everything, including changing roles and commission rates.
19. Confirm the client's example: Shivani (admin) can **see** the commission setup page but not
    **edit** rates, and the super admin can grant her edit rights alone, or to all admins at once.

## G. Security issue to raise (not a question — a finding)

20. The school's Razorpay webhook (in the `Ai-Agent` backend) **saves a payment even when the
    request carries no signature**. That means the only thing stopping forged payment entries is
    that outsiders don't know the address — and the whole team does. It should reject any unsigned
    or wrongly-signed request. We can hand over the two-line fix. Worth closing before commissions
    are paid on that data.
