import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import pool from "../db/pool";
import { requireAuth, forgetAuthCache } from "../middleware/auth";
import { requirePermission } from "../middleware/requirePermission";
import { requireOwner } from "../middleware/requireOwner";
import { open as unsealPassword, seal as sealPassword, vaultConfigured } from "../lib/passwordVault";
import { resolveRange, istDateKey } from "../lib/dateRange";
import { commissionOn, feeCommission, isTrial, monthBounds, monthPayout, proRated, type PayPlan } from "../lib/payroll";
import { paymentsConfigured, paymentsFor, PaymentsError, type Payment } from "../services/payments.service";
import { monthPay, PAY_COLS, periodTargets, requestToday, type PayEmployee } from "../services/pay.service";

// The Users tab (client, 12 Nov 2026): one account per person with rank, tabs, salary rule, line and targets.
const router = Router();
const usersTab = requirePermission("users");

const money = z.number().min(0).max(10_000_000);
// a real calendar date: "2026-11-31" matches the pattern but would crash the database, so it is refused here
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Dates must be YYYY-MM-DD")
  .refine((d) => !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().startsWith(d), "That date doesn't exist");
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Times must be HH:MM");
/** One flat bonus from the Users form ("Extra Commission"): name, ₹ amount, active dates. Old rule fields are stripped. */
export const extraSchema = z.object({
  name: z.string().trim().min(1, "Give it a name").max(60),
  amount: money,
  from: day, to: day,
}).refine((x) => x.from <= x.to, "The end date is before the start date");
/** One cut from the salary ("Extra Deduction"): ₹ or % of the fix salary, for a date range. */
const deductionSchema = z.object({
  name: z.string().trim().min(1, "Give it a name").max(60),
  type: z.enum(["fix", "pct"]),
  amount: money,
  from: day, to: day,
})
  .refine((x) => x.from <= x.to, "The end date is before the start date")
  .refine((x) => x.type === "fix" || x.amount <= 100, "A percentage can't be more than 100");
const fields = {
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().email().max(100),
  phone: z.string().trim().min(8).max(15).nullable(),
  role: z.enum(["owner", "admin", "employee"]),
  status: z.enum(["active", "inactive"]),
  employee_code: z.number().int().min(1).max(999_999_999), // "Reg No."
  designation: z.string().trim().max(60).nullable(),
  fix_salary: money.int(),
  trial_commission: money,
  trial_commission_type: z.enum(["pct", "fix"]),
  regular_commission: money,
  regular_commission_type: z.enum(["pct", "fix"]),
  target_call_secs: z.number().int().min(0).max(86_400),
  target_trial: z.number().int().min(0).max(1000),
  target_regular: z.number().int().min(0).max(1000),
  // daily salary (client, 15 Nov 2026): which targets count for the day's salary, and the first day paid
  tick_call: z.boolean(),
  tick_trial: z.boolean(),
  tick_regular: z.boolean(),
  join_date: day,
  extra_commissions: z.array(extraSchema).max(20),
  extra_deductions: z.array(deductionSchema).max(20),
  team_id: z.string().uuid().nullable(),
};
const extras = {
  password: z.string().min(8).max(72),
  // a tab key from the web's list, or a privilege such as export_leads
  permissions: z.array(z.string().regex(/^[a-z_]{2,30}$/)).max(60),
  line_id: z.string().uuid().nullable(),
  // the intercom on that line; saving moves the intercom onto the user's line (Intercoms tab shows it)
  intercom_id: z.string().uuid().nullable(),
};
const createSchema = z.object({ ...fields, ...extras }).partial().required({ name: true, email: true, password: true });
const patchSchema = z.object({ ...fields, ...extras }).partial();
const COLUMNS = Object.keys(fields) as (keyof typeof fields)[];

const SELECT =
  `SELECT e.id, e.name, e.email, e.phone, e.role, e.status, e.color_index, e.employee_code, e.designation,
          e.fix_salary, e.trial_commission::float, e.trial_commission_type, e.regular_commission::float, e.regular_commission_type,
          e.target_call_secs, e.target_trial, e.target_regular, e.extra_commissions, e.extra_deductions, e.team_id, e.created_at,
          e.tick_call, e.tick_trial, e.tick_regular, to_char(e.join_date, 'YYYY-MM-DD') AS join_date,
          ARRAY(SELECT permission FROM employee_permissions p WHERE p.employee_id = e.id) AS permissions,
          (SELECT l.id FROM lines l WHERE l.employee_id = e.id ORDER BY l.line_number LIMIT 1) AS line_id,
          (SELECT i.id FROM intercoms i JOIN lines l ON l.line_number = i.line_number WHERE l.employee_id = e.id ORDER BY l.line_number LIMIT 1) AS intercom_id
   FROM employees e`;

/** "Extra commission 2: The end date is before the start date" rather than a bare field path. */
const issue = (e: z.ZodError) => {
  const i = e.issues[0];
  const [field, n] = i.path;
  const what = field === "extra_commissions" ? "Extra commission" : field === "extra_deductions" ? "Extra deduction" : null;
  return what && typeof n === "number" ? `${what} ${n + 1}: ${i.message}` : i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message;
};
const bad = (res: any, status: number, message: string) => res.status(status).json({ error: message, message });
const conflict = (err: any) =>
  err?.code !== "23505" ? null : String(err.constraint).includes("employee_code") ? "That Reg No. is already used"
    // each person's own phone is unique: the employee login shows it as their contact (client, 28 Nov 2026)
    : String(err.constraint).includes("phone") ? "That phone number is already used by another person" : "Email already in use by another account";

router.use(requireAuth);

router.get("/names", async (_req, res) => {
  const result = await pool.query(
    "SELECT id, name, color_index, color, employee_code FROM employees WHERE status = 'active' ORDER BY name ASC"
  );
  return res.json(result.rows);
});

router.get("/", usersTab, async (_req, res) => {
  return res.json((await pool.query(`${SELECT} ORDER BY e.created_at ASC`)).rows);
});

/**
 * The signed-in user's own header: details, today's targets and what is still pending, and
 * income for the picked range.
 * shortcut: a joining is counted from CRM conversions (a lead this user saved with a "paid" code),
 * all as trial; regular joinings and their commission stay 0 until the Payments feed exists.
 */
const PLAN_COLS = `e.fix_salary, e.trial_commission::float, e.trial_commission_type,
  e.regular_commission::float, e.regular_commission_type, e.extra_commissions, e.extra_deductions`;

/** One payment as the dashboard shows it, with the commission it earned. */
const paymentRow = (plan: PayPlan) => (p: Payment) => ({
  id: p.id, name: p.name, paid_date: p.paidDate, mode: p.paymentMode, fee_type: p.feeType, linked_to: p.linkedTo,
  amount: p.amountPaise / 100, commission: feeCommission(plan, p), trial: isTrial(p), receipt_url: p.receiptUrl,
});

// /me/summary = My Dashboard; /:id/summary = the Super Admin's eye on one user's dashboard (Employee Tracker)
router.get(["/me/summary", "/:id/summary"], async (req, res) => {
  if (req.params.id && req.user!.role !== "owner") return bad(res, 403, "Forbidden");
  if (req.params.id && !z.string().uuid().safeParse(req.params.id).success) return bad(res, 404, "Not found");
  const id = req.params.id ?? req.user!.sub;
  const { start, end } = resolveRange(
    typeof req.query.date_from === "string" ? req.query.date_from : null,
    typeof req.query.date_to === "string" ? req.query.date_to : null
  );
  const today = requestToday(req.query);
  const lastDay = istDateKey(new Date(end.getTime() - 1));
  // the targets box shows the day picked (Today, Yesterday or one custom day); a longer period shows today
  // (client, 15 Nov 2026: after midnight "Today's targets" read 0 while the cards showed yesterday)
  const targetDay = istDateKey(start) === lastDay ? lastDay : today;
  const [me, talk, payRow, saved] = await Promise.all([
    pool.query(
      `SELECT e.name, e.phone, e.email, e.employee_code, e.designation, e.role, e.status, to_char(e.left_on, 'YYYY-MM-DD') AS left_on, e.color_index, ${PLAN_COLS},
              e.target_call_secs, e.target_trial, e.target_regular, e.tick_call, e.tick_trial, e.tick_regular,
              l.line_number, i.intercom_code, i.phone_number AS calling_number
       FROM employees e
       LEFT JOIN LATERAL (SELECT line_number FROM lines WHERE employee_id = e.id ORDER BY line_number LIMIT 1) l ON TRUE
       LEFT JOIN intercoms i ON i.line_number = l.line_number
       WHERE e.id = $1`, [id]),
    pool.query(
      // every call, short ones too: the same total as the Talk time card, so the two never disagree (client, 14 Nov 2026)
      `SELECT COALESCE(SUM(duration_secs), 0)::int AS secs FROM calls
       WHERE employee_id = $1 AND called_at >= ($2::date::timestamp AT TIME ZONE 'Asia/Kolkata')
         AND called_at < (($2::date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata')`, [id, targetDay]),
    pool.query(`SELECT ${PAY_COLS} FROM employees e WHERE e.id = $1`, [id]),
    // a day that has closed keeps the targets it had (client, 15 Nov 2026): "keep the finished day's targets fixed"
    pool.query(
      `SELECT target_call_secs, target_trial, target_regular, tick_call, tick_trial, tick_regular FROM day_targets
       WHERE employee_id = $1 AND day = $2::date AND $2::date < $3::date`, [id, targetDay, today]),
  ]);
  const u = me.rows[0];
  if (!u) return bad(res, 404, "Not found");

  // Joinings and commission come from the school's payments; if that service is down the rest of the page still loads
  let list: Payment[] = [], todays: Payment[] = [], error: string | null = null;
  if (paymentsConfigured()) {
    try {
      [list, todays] = await Promise.all([
        paymentsFor(id, istDateKey(start), lastDay),
        paymentsFor(id, targetDay, targetDay),
      ]);
    } catch (e) {
      if (!(e instanceof PaymentsError)) throw e;
      error = e.message;
    }
  }
  const c = commissionOn(u, list);
  const t = commissionOn(u, todays);
  // the pay shown is for the month the picked period ends in, from the same calculation as the Employee Tracker
  // and the Days view (services/pay.service.ts), so the three can never disagree
  const [p] = await monthPay([payRow.rows[0] as PayEmployee], lastDay.slice(0, 7), today);
  const { payments: _monthPayments, days: payDays, ...payOut } = p;
  const dayRow = payDays?.find((x) => x.day === targetDay) ?? null;
  // a longer period: how often each ticked target was met, day by day (client, 16 Nov 2026), instead of today's box
  const oneDay = istDateKey(start) === lastDay;
  const period = oneDay ? null : await periodTargets(payRow.rows[0] as PayEmployee, istDateKey(start), lastDay, today, p);
  // the picked period's salary, from the same per-day pay as the Days view: one day's share, or the daily-pay days
  // in a longer period; null when not on daily pay or the period is over 3 months (client, 19 Nov 2026)
  const periodSalary = oneDay
    ? (p.mode === "daily" ? (dayRow?.paise ?? 0) / 100 : null)
    : (period && !period.too_long && period.salary ? period.salary.earned : null);
  const t0 = saved.rows[0] ?? u;
  return res.json({
    ...u,
    period,
    today: {
      date: targetDay, is_today: targetDay === today, final: targetDay < today, call_secs: talk.rows[0].secs, trial: t.trial.count, regular: t.regular.count,
      // the day's targets: saved ones for a closed day, the current ones for today
      targets: { call_secs: t0.target_call_secs, trial: t0.target_trial, regular: t0.target_regular,
        tick_call: !!t0.tick_call, tick_trial: !!t0.tick_trial, tick_regular: !!t0.tick_regular },
      // daily pay: that day's share and salary, exactly as the Days view and the Employee Tracker count it
      pay: dayRow && (dayRow.kind === "working" || dayRow.kind === "away")
        ? { kind: dayRow.kind, num: dayRow.num, den: dayRow.den, salary: dayRow.paise / 100, count_as_full: dayRow.countAsFull, custom: dayRow.customPaise !== null, parts: dayRow.parts }
        : null,
    },
    // the box beside the month total follows the period picker (client, 19 Nov 2026): salary + commission on its fees
    earnings: { from: istDateKey(start), to: lastDay, salary: periodSalary, commission: c.commission, fees: c.trial.count + c.regular.count },
    income: { joinings: c.trial.count + c.regular.count, trial: c.trial.commission, regular: c.regular.commission, total: c.commission,
      trial_count: c.trial.count, regular_count: c.regular.count, fees: c.trial.fees + c.regular.fees },
    payments: { connected: paymentsConfigured() && !error, error, list: list.map(paymentRow(u)) },
    pay: payOut,
  });
});

// Employee Tracker: every active User's, Admin's and (when linked on the school site) Owner's pay for one month,
// from the school's payments (Super Admin only). The Owner account is Varinder Max on the school site (client, 15 Nov 2026).
// Someone switched off during that month is listed too (client, 14 Nov 2026): salary for the days worked,
// payments up to the day they left. Before that month they show as usual; after it, not at all.
/**
 * "Add to this month" (client, 17 Nov 2026): the commission of the payments dated in a closed `month` that arrived
 * after it closed, added as ONE extra commission starting today (so it is paid in the current month's payout), and
 * marked as added so it can't be added twice. Super Admin only.
 */
router.post("/:id/late-payments/add", requireOwner, async (req, res) => {
  if (!z.string().uuid().safeParse(req.params.id).success) return bad(res, 404, "Not found");
  const month = typeof req.body?.month === "string" && /^\d{4}-\d{2}$/.test(req.body.month) ? req.body.month : null;
  if (!month) return bad(res, 400, "month must be YYYY-MM");
  const today = requestToday(req.query);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: [e] } = await client.query("SELECT extra_commissions FROM employees WHERE id = $1 FOR UPDATE", [req.params.id]);
    if (!e) { await client.query("ROLLBACK"); return bad(res, 404, "Not found"); }
    const { rows } = await client.query(
      "SELECT payment_id, commission::float AS commission FROM late_payments WHERE employee_id = $1 AND month = $2 AND added_month IS NULL FOR UPDATE",
      [req.params.id, month]);
    if (!rows.length) { await client.query("ROLLBACK"); return bad(res, 400, "Nothing left to add for that month"); }
    const amount = Math.round(rows.reduce((t, r) => t + r.commission, 0));
    const label = new Date(`${month}-01T00:00`).toLocaleDateString("en-GB", { month: "short", year: "numeric" });
    const extra = { name: `Late payment${rows.length === 1 ? "" : "s"} – ${label}`.slice(0, 60), amount, from: today, to: today };
    await client.query("UPDATE employees SET extra_commissions = COALESCE(extra_commissions, '[]'::jsonb) || $2::jsonb WHERE id = $1",
      [req.params.id, JSON.stringify([extra])]);
    await client.query(
      "UPDATE late_payments SET added_month = $3, added_at = NOW(), added_by = $4 WHERE employee_id = $1 AND month = $2 AND added_month IS NULL",
      [req.params.id, month, today.slice(0, 7), req.user!.sub]);
    await client.query("COMMIT");
    return res.json({ added: extra, payments: rows.length });
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
});

router.get("/payroll", requireOwner, async (req, res) => {
  const today = requestToday(req.query);
  const month = typeof req.query.month === "string" ? req.query.month : today.slice(0, 7);
  const b = monthBounds(month);
  if (!b) return bad(res, 400, "month must be YYYY-MM");
  const { rows } = await pool.query(
    `SELECT ${PAY_COLS} FROM employees e WHERE (e.status = 'active' OR e.left_on >= $1::date) ORDER BY e.name`, [b.from]);
  const pays = await monthPay(rows as PayEmployee[], month, today);
  const out = rows.map((e, i) => {
    const { payments, days: _d, id: _id, ...p } = pays[i];
    // an Owner account is a person on the school site (Varinder Max): show the name payments are filed under
    const name = e.role === "owner" && payments[0]?.representativeName ? payments[0].representativeName : e.name;
    return { id: e.id, name, employee_code: e.employee_code, color_index: e.color_index, fix_salary: e.fix_salary, isOwner: e.role === "owner", ...p };
  });
  // owner accounts that aren't someone on the school site (the system "WATI LINE", a second owner) have no pay to show
  const people = out.filter((p) => !(p.isOwner && p.error));
  // payments dated in this month that showed up after it closed: listed for the Super Admin, never added (client, 17 Nov 2026)
  const { rows: late } = await pool.query(
    `SELECT employee_id, added_month, COUNT(*)::int AS count, SUM(commission)::float AS commission
     FROM late_payments WHERE month = $1 GROUP BY 1, 2`, [month]);
  // still to decide (added_month null) and already added to a later month, per person
  const lateOf = new Map<string, { count: number; commission: number; added: { count: number; commission: number; month: string }[] }>();
  for (const r of late) {
    const x = lateOf.get(r.employee_id) ?? { count: 0, commission: 0, added: [] };
    if (r.added_month) x.added.push({ count: r.count, commission: r.commission, month: String(r.added_month).trim() });
    else { x.count += r.count; x.commission += r.commission; }
    lateOf.set(r.employee_id, x);
  }
  return res.json({ month, from: b.from, to: b.to, connected: paymentsConfigured(), mode: pays[0]?.mode ?? null,
    final: pays[0]?.final ?? false, open_until: pays[0]?.open_until ?? null,
    people: people.map((p) => ({ ...p, late: lateOf.get(p.id) ?? null })) });
});

/**
 * The saved password of a User or Admin, for the Super Admin only (client, 15 Nov 2026; not logged). A Super Admin
 * sees only their OWN password, never another Super Admin's. A password set before this existed has no copy: type a new one and save.
 */
router.get("/:id/password", requireOwner, async (req, res) => {
  if (!z.string().uuid().safeParse(req.params.id).success) return bad(res, 404, "Not found");
  res.set("Cache-Control", "no-store");
  if (!vaultConfigured()) return res.json({ status: "not_set_up", password: null });
  const { rows: [r] } = await pool.query("SELECT role, password_enc FROM employees WHERE id = $1", [req.params.id]);
  if (!r) return bad(res, 404, "Not found");
  if (r.role === "owner" && req.params.id !== req.user!.sub) return bad(res, 403, "Another Super Admin's password can't be shown");
  const password = r.password_enc ? unsealPassword(r.password_enc) : null;
  return res.json({ status: password ? "ok" : "not_saved", password });
});

router.get("/:id", async (req, res) => {
  const id = req.params.id;
  if (!req.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (req.user.role === "employee" && req.user.sub !== id) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const result = await pool.query(`${SELECT} WHERE e.id = $1 LIMIT 1`, [id]);

  if (result.rows.length === 0) {
    return res.status(404).json({ error: "Not found" });
  }

  return res.json(result.rows[0]);
});

/** The statement that takes a person off their lines (`$ID` is their id parameter); callers add RETURNING / chain the intercoms. */
const FREE_LINES = `UPDATE lines SET employee_id = NULL, assigned_at = NULL, freed_at = NOW() WHERE employee_id = $ID::uuid`;

/** Columns, ticked tabs and line in one transaction; `id` null = a new user. */
async function saveUser(id: string | null, d: z.infer<typeof patchSchema>): Promise<string | null> {
  const cols = COLUMNS.filter((c) => d[c] !== undefined);
  const values: unknown[] = cols.map((c) => (c === "extra_commissions" || c === "extra_deductions" ? JSON.stringify(d[c]) : d[c]));
  if (d.password !== undefined) {
    cols.push("password_hash" as any);
    values.push(await bcrypt.hash(d.password, 12));
    // the Super Admin's "Show saved password" copy: encrypted, or null when the key isn't set up (never a stale one)
    cols.push("password_enc" as any);
    values.push(sealPassword(d.password));
  }
  // the day someone is switched off, for the Employee Tracker; kept on later saves, cleared when switched back on
  const sets = cols.map((c, i) => `${c} = $${i + 1}`);
  if (d.status !== undefined) {
    sets.push(`left_on = CASE WHEN $${cols.indexOf("status" as any) + 1}::varchar = 'inactive' THEN COALESCE(left_on, (NOW() AT TIME ZONE 'Asia/Kolkata')::date) END`);
  }
  // Only columns changed (a status toggle, a plain edit): one statement, no transaction. Each round trip to the
  // database costs ~110 ms, so BEGIN / COMMIT around a single UPDATE was a fifth of the wait.
  if (id && d.permissions === undefined && d.line_id === undefined && d.intercom_id === undefined && d.employee_code === undefined) {
    if (!cols.length) return id;
    const n = cols.length + 1;
    // switching someone off frees their line (no agent) and takes their intercom off it; the intercom keeps its number
    const sql = d.status === "inactive"
      ? `WITH me AS (UPDATE employees SET ${sets.join(", ")} WHERE id = $${n} RETURNING id),
              freed AS (${FREE_LINES.replace("$ID", `$${n}`)} RETURNING line_number),
              ic AS (UPDATE intercoms SET line_number = NULL WHERE line_number IN (SELECT line_number FROM freed))
         SELECT id FROM me`
      : `UPDATE employees SET ${sets.join(", ")} WHERE id = $${n} RETURNING id`;
    const r = await pool.query(sql, [...values, id]);
    forgetAuthCache();
    return r.rows.length ? id : null;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (!id) {
      if (d.join_date === undefined) { cols.push("join_date" as any); values.push(istDateKey(new Date())); }
      cols.push("color_index" as any);
      values.push(Number((await client.query("SELECT COALESCE(MAX(color_index), -1) + 1 AS n FROM employees")).rows[0].n));
      id = (await client.query(
        `INSERT INTO employees (${cols.join(", ")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING id`, values)).rows[0].id;
      if (d.status === "inactive") await client.query("UPDATE employees SET left_on = (NOW() AT TIME ZONE 'Asia/Kolkata')::date WHERE id = $1", [id]);
    } else if (cols.length) {
      const r = await client.query(`UPDATE employees SET ${sets.join(", ")} WHERE id = $${cols.length + 1} RETURNING id`, [...values, id]);
      if (!r.rows.length) { await client.query("ROLLBACK"); return null; }
    }
    // a Reg No. typed by hand must not collide with the next automatic one
    if (d.employee_code !== undefined) await client.query("SELECT setval('employees_employee_code_seq', (SELECT MAX(employee_code) FROM employees))");
    if (d.permissions !== undefined) {
      // one statement: drop the ticks no longer wanted, add the new ones
      await client.query(
        `WITH gone AS (DELETE FROM employee_permissions WHERE employee_id = $1 AND permission <> ALL($2::text[]))
         INSERT INTO employee_permissions (employee_id, permission) SELECT $1, unnest($2::text[]) ON CONFLICT DO NOTHING`, [id, d.permissions]);
    }
    const leaving = d.status === "inactive";
    if (leaving) {
      // switched off: their line is freed and their intercom leaves it (keeping its calling number); nothing new is given
      await client.query(
        `WITH freed AS (${FREE_LINES.replace("$ID", "$1")} RETURNING line_number)
         UPDATE intercoms SET line_number = NULL WHERE line_number IN (SELECT line_number FROM freed)`, [id]);
    } else if (d.line_id) {
      // one person per line (client, 15 Nov): a line another person holds can't be taken, and a switched-off person can't hold one
      const h = (await client.query(
        `SELECT l.line_number, l.employee_id AS holder, e.name AS holder_name, (SELECT status FROM employees WHERE id = $2) AS status
         FROM lines l LEFT JOIN employees e ON e.id = l.employee_id WHERE l.id = $1`, [d.line_id, id])).rows[0];
      if (!h) throw Object.assign(new Error("That line doesn't exist"), { status: 400 });
      if (h.status === "inactive") throw Object.assign(new Error("A switched-off person can't hold a line"), { status: 400 });
      if (h.holder && h.holder !== id) {
        throw Object.assign(new Error(`Line ${h.line_number} is with ${h.holder_name}. Free it first, or use Swap agents on the Intercoms tab.`), { status: 400 });
      }
    }
    if (d.line_id !== undefined && !leaving) {
      // one line per user in the form: the picked line moves to them, their earlier line is freed
      // in one statement: the picked line is theirs (keeping its date if it already was), their other lines are freed
      await client.query(
        `UPDATE lines SET employee_id = CASE WHEN id = $2::uuid THEN $1::uuid END,
                          assigned_at = CASE WHEN id = $2::uuid THEN COALESCE(CASE WHEN employee_id = $1::uuid THEN assigned_at END, NOW()) END,
                          freed_at = CASE WHEN id = $2::uuid THEN freed_at ELSE NOW() END
         WHERE employee_id = $1::uuid OR id = $2::uuid`, [id, d.line_id || null]);
    }
    if (d.intercom_id !== undefined && !leaving) {
      const line = (await client.query("SELECT line_number FROM lines WHERE employee_id = $1 ORDER BY line_number LIMIT 1", [id])).rows[0]?.line_number;
      if (d.intercom_id && !line) throw Object.assign(new Error("Pick a line for the intercom"), { status: 400 });
      if (line) {
        // the line's old intercom is freed first: one intercom per line
        await client.query("UPDATE intercoms SET line_number = NULL WHERE line_number = $1 AND id IS DISTINCT FROM $2", [line, d.intercom_id]);
        if (d.intercom_id) await client.query("UPDATE intercoms SET line_number = $1 WHERE id = $2", [line, d.intercom_id]);
      }
    }
    await client.query("COMMIT");
    forgetAuthCache();
    return id;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

/** Only a Super Admin makes or changes a Super Admin, and nobody changes their own rank or switches themselves off. */
async function rankProblem(req: any, targetId: string | null, d: z.infer<typeof patchSchema>): Promise<string | null> {
  const me = req.user!;
  if (targetId === me.sub && (d.role !== undefined || d.status !== undefined)) {
    const { rows } = await pool.query("SELECT role, status FROM employees WHERE id = $1", [targetId]);
    if (rows[0] && ((d.role ?? rows[0].role) !== rows[0].role || (d.status ?? rows[0].status) !== rows[0].status)) return "You can't change your own rank or status";
  }
  if (me.role === "owner") return null;
  // only the Super Admin hands out access, so nobody can give themselves more
  if (targetId === me.sub && d.permissions !== undefined) return "Only a Super Admin can change your own tabs";
  if (d.role === "owner") return "Only a Super Admin can make a Super Admin";
  if (targetId) {
    const { rows } = await pool.query("SELECT role FROM employees WHERE id = $1", [targetId]);
    if (rows[0]?.role === "owner") return "Only a Super Admin can change a Super Admin";
  }
  return null;
}

router.post("/", usersTab, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return bad(res, 400, issue(parsed.error));
  const problem = await rankProblem(req, null, parsed.data);
  if (problem) return bad(res, 403, problem);
  try {
    const id = await saveUser(null, parsed.data);
    return res.status(201).json((await pool.query(`${SELECT} WHERE e.id = $1`, [id])).rows[0]);
  } catch (err: any) {
    if (err?.status === 400) return bad(res, 400, err.message);
    if (err?.code === "23503") return bad(res, 400, "That team no longer exists");
    const msg = conflict(err);
    if (msg) return bad(res, 409, msg);
    throw err;
  }
});

router.patch("/:id", usersTab, async (req, res) => {
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) return bad(res, 400, issue(parsed.error));
  if (!z.string().uuid().safeParse(req.params.id).success) return bad(res, 404, "Not found");
  const problem = await rankProblem(req, req.params.id, parsed.data);
  if (problem) return bad(res, 403, problem);
  try {
    const id = await saveUser(req.params.id, parsed.data);
    if (!id) return bad(res, 404, "Not found");
    return res.json((await pool.query(`${SELECT} WHERE e.id = $1`, [id])).rows[0]);
  } catch (err: any) {
    if (err?.status === 400) return bad(res, 400, err.message);
    if (err?.code === "23503") return bad(res, 400, "That team no longer exists");
    const msg = conflict(err);
    if (msg) return bad(res, 409, msg);
    throw err;
  }
});

export default router;
