import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import pool from "../db/pool";
import { requireAuth } from "../middleware/auth";
import { requirePermission } from "../middleware/requirePermission";
import { requireOwner } from "../middleware/requireOwner";
import { resolveRange, IST_TODAY_START, istDateKey } from "../lib/dateRange";
import { commissionOn, isTrial, monthBounds, monthPayout, type PayPlan } from "../lib/payroll";
import { paymentsConfigured, paymentsFor, PaymentsError, type Payment } from "../services/payments.service";

// The Users tab (client, 12 Nov 2026): one account per person with rank, tabs, salary rule, line and targets.
const router = Router();
const usersTab = requirePermission("users");

const money = z.number().min(0).max(10_000_000);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Dates must be YYYY-MM-DD");
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
  other_amount: money.int(),
  target_call_secs: z.number().int().min(0).max(86_400),
  target_trial: z.number().int().min(0).max(1000),
  target_regular: z.number().int().min(0).max(1000),
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
          e.other_amount, e.target_call_secs, e.target_trial, e.target_regular, e.extra_commissions, e.extra_deductions, e.team_id, e.created_at,
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
  err?.code !== "23505" ? null : String(err.constraint).includes("employee_code") ? "That Reg No. is already used" : "Email already in use by another account";

router.use(requireAuth);

router.get("/names", async (_req, res) => {
  const result = await pool.query(
    "SELECT id, name, color_index FROM employees WHERE status = 'active' ORDER BY name ASC"
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
const PLAN_COLS = `e.fix_salary, e.other_amount, e.trial_commission::float, e.trial_commission_type,
  e.regular_commission::float, e.regular_commission_type, e.extra_commissions, e.extra_deductions`;

/** One payment as the dashboard shows it, with the commission it earned. */
const paymentRow = (plan: PayPlan) => (p: Payment) => ({
  id: p.id, name: p.name, paid_date: p.paidDate, mode: p.paymentMode, fee_type: p.feeType, linked_to: p.linkedTo,
  amount: p.amountPaise / 100, commission: commissionOn(plan, [p]).commission, trial: isTrial(p), receipt_url: p.receiptUrl,
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
  const [me, talk] = await Promise.all([
    pool.query(
      `SELECT e.name, e.phone, e.email, e.employee_code, e.designation, e.role, e.color_index, ${PLAN_COLS},
              e.target_call_secs, e.target_trial, e.target_regular, l.line_number, i.intercom_code, i.phone_number AS calling_number
       FROM employees e
       LEFT JOIN LATERAL (SELECT line_number FROM lines WHERE employee_id = e.id ORDER BY line_number LIMIT 1) l ON TRUE
       LEFT JOIN intercoms i ON i.line_number = l.line_number
       WHERE e.id = $1`, [id]),
    pool.query(
      `SELECT COALESCE(SUM(duration_secs), 0)::int AS secs FROM calls
       WHERE employee_id = $1 AND is_misc = FALSE AND called_at >= ${IST_TODAY_START} AND called_at < ${IST_TODAY_START} + INTERVAL '1 day'`, [id]),
  ]);
  const u = me.rows[0];
  if (!u) return bad(res, 404, "Not found");

  // Joinings and commission come from the school's payments; if that service is down the rest of the page still loads
  const today = istDateKey(new Date());
  let list: Payment[] = [], todays: Payment[] = [], error: string | null = null;
  if (paymentsConfigured()) {
    try {
      [list, todays] = await Promise.all([
        paymentsFor(id, istDateKey(start), istDateKey(new Date(end.getTime() - 1))),
        paymentsFor(id, today, today),
      ]);
    } catch (e) {
      if (!(e instanceof PaymentsError)) throw e;
      error = e.message;
    }
  }
  const c = commissionOn(u, list);
  const t = commissionOn(u, todays);
  return res.json({
    ...u,
    today: { call_secs: talk.rows[0].secs, trial: t.trial.count, regular: t.regular.count },
    income: { joinings: c.trial.count + c.regular.count, trial: c.trial.commission, regular: c.regular.commission, total: c.commission,
      trial_count: c.trial.count, regular_count: c.regular.count, fees: c.trial.fees + c.regular.fees },
    payments: { connected: paymentsConfigured() && !error, error, list: list.map(paymentRow(u)) },
  });
});

// Employee Tracker: every active User's pay for one month, from the school's payments (Super Admin only)
router.get("/payroll", requireOwner, async (req, res) => {
  const month = typeof req.query.month === "string" ? req.query.month : istDateKey(new Date()).slice(0, 7);
  const b = monthBounds(month);
  if (!b) return bad(res, 400, "month must be YYYY-MM");
  const { rows } = await pool.query(
    `SELECT e.id, e.name, e.employee_code, e.color_index, ${PLAN_COLS}
     FROM employees e WHERE e.role = 'employee' AND e.status = 'active' ORDER BY e.name`);
  const connected = paymentsConfigured();
  // a few reps at a time, so a large team doesn't flood the school's server
  const out: unknown[] = [];
  for (let i = 0; i < rows.length; i += 4) {
    out.push(...await Promise.all(rows.slice(i, i + 4).map(async (e) => {
      let list: Payment[] = [], error: string | null = null;
      if (connected) {
        try { list = await paymentsFor(e.id, b.from, b.to); } catch (err) {
          if (!(err instanceof PaymentsError)) throw err;
          error = err.message;
        }
      }
      const { extra_commissions: _x, extra_deductions: _d, ...who } = e;
      return { ...who, error, ...monthPayout(e, list, b.from, b.to) };
    })));
  }
  return res.json({ month, from: b.from, to: b.to, connected, people: out });
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

/** Columns, ticked tabs and line in one transaction; `id` null = a new user. */
async function saveUser(id: string | null, d: z.infer<typeof patchSchema>): Promise<string | null> {
  const cols = COLUMNS.filter((c) => d[c] !== undefined);
  const values: unknown[] = cols.map((c) => (c === "extra_commissions" || c === "extra_deductions" ? JSON.stringify(d[c]) : d[c]));
  if (d.password !== undefined) {
    cols.push("password_hash" as any);
    values.push(await bcrypt.hash(d.password, 12));
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (!id) {
      cols.push("color_index" as any);
      values.push(Number((await client.query("SELECT COALESCE(MAX(color_index), -1) + 1 AS n FROM employees")).rows[0].n));
      id = (await client.query(
        `INSERT INTO employees (${cols.join(", ")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING id`, values)).rows[0].id;
    } else if (cols.length) {
      const r = await client.query(
        `UPDATE employees SET ${cols.map((c, i) => `${c} = $${i + 1}`).join(", ")} WHERE id = $${cols.length + 1} RETURNING id`, [...values, id]);
      if (!r.rows.length) { await client.query("ROLLBACK"); return null; }
    }
    // a Reg No. typed by hand must not collide with the next automatic one
    if (d.employee_code !== undefined) await client.query("SELECT setval('employees_employee_code_seq', (SELECT MAX(employee_code) FROM employees))");
    if (d.permissions !== undefined) {
      await client.query("DELETE FROM employee_permissions WHERE employee_id = $1", [id]);
      await client.query("INSERT INTO employee_permissions (employee_id, permission) SELECT $1, unnest($2::text[]) ON CONFLICT DO NOTHING", [id, d.permissions]);
    }
    if (d.line_id !== undefined) {
      // one line per user in the form: the picked line moves to them, their earlier line is freed
      await client.query("UPDATE lines SET employee_id = NULL, assigned_at = NULL WHERE employee_id = $1 AND id IS DISTINCT FROM $2", [id, d.line_id]);
      if (d.line_id) await client.query("UPDATE lines SET employee_id = $1, assigned_at = NOW() WHERE id = $2 AND employee_id IS DISTINCT FROM $1", [id, d.line_id]);
    }
    if (d.intercom_id !== undefined) {
      const line = (await client.query("SELECT line_number FROM lines WHERE employee_id = $1 ORDER BY line_number LIMIT 1", [id])).rows[0]?.line_number;
      if (d.intercom_id && !line) throw Object.assign(new Error("Pick a line for the intercom"), { status: 400 });
      if (line) {
        // the line's old intercom is freed first: one intercom per line
        await client.query("UPDATE intercoms SET line_number = NULL WHERE line_number = $1 AND id IS DISTINCT FROM $2", [line, d.intercom_id]);
        if (d.intercom_id) await client.query("UPDATE intercoms SET line_number = $1 WHERE id = $2", [line, d.intercom_id]);
      }
    }
    await client.query("COMMIT");
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
