import { Router } from "express";
import { z } from "zod";
import pool from "../db/pool";
import { requireAuth } from "../middleware/auth";
import { requireOwner } from "../middleware/requireOwner";
import { requirePermission } from "../middleware/requirePermission";
import { monthBounds, workingDaysOf } from "../lib/payroll";
import {
  closeDays, closeMonths, findLatePayments, forgetPayCalendar, holidaysBetween, isDailyMonth, monthPay, PAY_COLS, payCalendar, requestToday, type PayEmployee,
} from "../services/pay.service";

// Daily salary (client, 15 Nov 2026; docs/salary-commission/EMPLOYEE-PAYMENT-FLOW.md): the Working days panel,
// holidays, the day-by-day view and "Count as full". Changing anything here is the Super Admin's only.
const router = Router();
router.use(requireAuth);

const bad = (res: any, status: number, message: string) => res.status(status).json({ error: message, message });
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const day = z.string().regex(DAY, "Dates must be YYYY-MM-DD").refine((d) => !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().startsWith(d), "That date doesn't exist");
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Months must be YYYY-MM");

/** The Working days panel: the weekly pattern, the start month and every holiday. */
// the Working Days tab (Users → Tabs); the Super Admin has every tab
const workingDaysTab = requirePermission("working_days");
router.get("/settings", workingDaysTab, async (req, res) => {
  const cal = await payCalendar();
  const { rows } = await pool.query("SELECT to_char(day, 'YYYY-MM-DD') AS day, name FROM holidays ORDER BY day");
  const m = typeof req.query.month === "string" && monthBounds(req.query.month) ? req.query.month : requestToday(req.query).slice(0, 7);
  const b = monthBounds(m)!;
  const working = workingDaysOf(m, cal.weekdays, await holidaysBetween(b.from, b.to)).length;
  return res.json({ ...cal, holidays: rows, month: m, working_days: working, daily: isDailyMonth(cal, m) });
});

const settingsSchema = z.object({
  weekdays: z.array(z.number().int().min(1).max(7)).min(1, "Tick at least one working day").max(7)
    .refine((w) => new Set(w).size === w.length, "A weekday is ticked twice"),
  daily_pay_from: month.nullable(),
});
router.put("/settings", workingDaysTab, async (req, res) => {
  const p = settingsSchema.safeParse(req.body);
  if (!p.success) return bad(res, 400, p.error.issues[0].message);
  const weekdays = [...p.data.weekdays].sort((a, b) => a - b);
  await pool.query(
    `INSERT INTO pay_settings (key, value, updated_at) VALUES ('weekdays', $1::jsonb, NOW()), ('daily_pay_from', $2::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [JSON.stringify(weekdays), JSON.stringify(p.data.daily_pay_from)]);
  forgetPayCalendar();
  return res.json({ weekdays, daily_pay_from: p.data.daily_pay_from });
});

const holidaySchema = z.object({ day, name: z.string().trim().min(1, "Give the holiday a name").max(60) });
router.post("/holidays", workingDaysTab, async (req, res) => {
  const p = holidaySchema.safeParse(req.body);
  if (!p.success) return bad(res, 400, p.error.issues[0].message);
  if (await isClosedMonth(p.data.day)) return bad(res, 400, "That month is final: its working days can't change");
  const r = await pool.query("INSERT INTO holidays (day, name) VALUES ($1, $2) ON CONFLICT (day) DO NOTHING RETURNING to_char(day, 'YYYY-MM-DD') AS day, name", [p.data.day, p.data.name]);
  if (!r.rows[0]) return bad(res, 409, "That date is already a holiday");
  return res.status(201).json(r.rows[0]);
});
router.delete("/holidays/:day", workingDaysTab, async (req, res) => {
  if (!day.safeParse(req.params.day).success) return bad(res, 400, "Dates must be YYYY-MM-DD");
  if (await isClosedMonth(req.params.day)) return bad(res, 400, "That month is final: its working days can't change");
  const r = await pool.query("DELETE FROM holidays WHERE day = $1", [req.params.day]);
  return r.rowCount ? res.status(204).end() : bad(res, 404, "No holiday on that date");
});

/**
 * One person's month, day by day, and the month's totals — the same numbers as their Employee Tracker row and their
 * dashboard (all three use monthPay). The Super Admin may open anyone; everyone else only themselves.
 */
router.get("/days", async (req, res) => {
  const me = req.user!;
  const id = typeof req.query.employee_id === "string" ? req.query.employee_id : me.sub;
  if (!z.string().uuid().safeParse(id).success) return bad(res, 404, "Not found");
  if (id !== me.sub && me.role !== "owner") return bad(res, 403, "Only the Super Admin can open someone else's days");
  const today = requestToday(req.query);
  const m = typeof req.query.month === "string" ? req.query.month : today.slice(0, 7);
  if (!monthBounds(m)) return bad(res, 400, "Months must be YYYY-MM");
  const { rows: [e] } = await pool.query(`SELECT ${PAY_COLS} FROM employees e WHERE e.id = $1`, [id]);
  if (!e) return bad(res, 404, "Not found");
  const [p] = await monthPay([e as PayEmployee], m, today);
  const { payments: _p, ...rest } = p;
  return res.json({ ...rest, name: e.name, fix_salary: e.fix_salary, today });
});

/** "Count as full" on one working day (or undo it). Super Admin only; only a day that has happened. */
const overrideSchema = z.object({ employee_id: z.string().uuid(), day, full: z.boolean() });
router.put("/overrides", requireOwner, async (req, res) => {
  const p = overrideSchema.safeParse(req.body);
  if (!p.success) return bad(res, 400, p.error.issues[0].message);
  const today = requestToday(req.query);
  if (p.data.day > today) return bad(res, 400, "That day hasn't happened yet");
  if (await isClosedMonth(p.data.day)) return bad(res, 400, "That month is final: its days can't change");
  const cal = await payCalendar();
  const hol = await holidaysBetween(p.data.day, p.data.day);
  if (!workingDaysOf(p.data.day.slice(0, 7), cal.weekdays, hol).includes(p.data.day)) return bad(res, 400, "That day is not a working day");
  const { rows: [e] } = await pool.query("SELECT id FROM employees WHERE id = $1", [p.data.employee_id]);
  if (!e) return bad(res, 404, "Not found");
  if (p.data.full) {
    await pool.query("INSERT INTO day_overrides (employee_id, day, set_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [p.data.employee_id, p.data.day, req.user!.sub]);
  } else {
    await pool.query("DELETE FROM day_overrides WHERE employee_id = $1 AND day = $2", [p.data.employee_id, p.data.day]);
  }
  return res.json({ employee_id: p.data.employee_id, day: p.data.day, full: p.data.full });
});

/** Tests only (not in production): close the months whose 10 days have passed by `today`, then look for late payments. */
router.post("/dev/close-months", requireOwner, async (req, res) => {
  if (process.env.NODE_ENV === "production") return bad(res, 404, "Not found");
  const today = typeof req.body?.today === "string" && DAY.test(req.body.today) ? req.body.today : undefined;
  const closed = await closeMonths(today);
  return res.json({ closed, late: await findLatePayments(today) });
});

/** Tests only (not in production): close the days up to the day before `today` now, instead of waiting for midnight. */
router.post("/dev/close-days", requireOwner, async (req, res) => {
  if (process.env.NODE_ENV === "production") return bad(res, 404, "Not found");
  const today = typeof req.body?.today === "string" && DAY.test(req.body.today) ? req.body.today : undefined;
  return res.json({ closed: await closeDays(today) });
});

/** A day in a month that has closed (final). */
async function isClosedMonth(day: string) {
  return !!(await pool.query("SELECT 1 FROM months_closed WHERE month = $1", [day.slice(0, 7)])).rows[0];
}

export default router;
