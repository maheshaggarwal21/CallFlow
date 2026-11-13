import { Router } from "express";
import { z } from "zod";
import pool from "../db/pool";
import { requireAuth } from "../middleware/auth";
import { requirePermission } from "../middleware/requirePermission";
import { resolveRange } from "../lib/dateRange";
import { rangeLabel, reportWindow } from "../lib/reportSchedule";
import { htmlToPdf, reportData, reportHtml, type PdfInput } from "../lib/reportPdf";
import {
  buildEmployeeReport,
  employeesStats,
  pdfPerson,
  sendScheduledReport,
  type ReportSchedule,
} from "../services/report.service";

const router = Router();
router.use(requireAuth);
// A User (employee rank) only ever gets their own report: it is their home page. Everything else needs the Reports tab.
const reportsTab = requirePermission("reports");
router.use((req, res, next) => {
  if ((req.path === "/data" || req.path === "/view") && req.user?.role === "employee") {
    req.query.employee_id = req.user.sub;
    return next();
  }
  return reportsTab(req, res, next);
});

const scheduleSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    employee_ids: z.array(z.string().uuid()).min(1, "Pick at least one employee").max(100),
    frequency: z.enum(["daily", "weekly", "monthly"]),
    send_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Time must be HH:MM"),
    weekday: z.number().int().min(0).max(6).nullable().optional(),
    recipients: z.array(z.string().trim().email().max(200)).min(1, "Add at least one email").max(20),
    subject_template: z.string().trim().min(1).max(300),
    body_template: z.string().trim().min(1).max(10000),
    combine_employees: z.boolean().optional(),
    is_active: z.boolean().optional(),
  })
  .refine((s) => s.frequency !== "weekly" || s.weekday != null, {
    message: "Pick a weekday for weekly reports",
  });

function parseSchedule(body: unknown) {
  const parsed = scheduleSchema.safeParse(body);
  if (parsed.success) return { data: parsed.data };
  const issue = parsed.error.issues[0];
  const msg = issue.path.length ? `${issue.path.join(".")}: ${issue.message}` : issue.message;
  return { error: msg };
}

const SCHEDULE_COLS =
  "id, name, employee_ids, frequency, to_char(send_time, 'HH24:MI') AS send_time, weekday, " +
  "recipients, subject_template, body_template, combine_employees, is_active, created_at, updated_at";

router.get("/schedules", async (_req, res) => {
  const result = await pool.query(`SELECT ${SCHEDULE_COLS} FROM report_schedules ORDER BY created_at ASC`);
  return res.json(result.rows);
});

router.post("/schedules", async (req, res) => {
  const { data, error } = parseSchedule(req.body);
  if (!data) return res.status(400).json({ error, message: error });
  const result = await pool.query(
    `INSERT INTO report_schedules
       (name, employee_ids, frequency, send_time, weekday, recipients, subject_template, body_template, is_active, combine_employees)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING ${SCHEDULE_COLS}`,
    [data.name, data.employee_ids, data.frequency, data.send_time,
     data.frequency === "weekly" ? data.weekday : null,
     data.recipients, data.subject_template, data.body_template, data.is_active ?? true, data.combine_employees ?? false]
  );
  return res.status(201).json(result.rows[0]);
});

router.patch("/schedules/:id", async (req, res) => {
  const { data, error } = parseSchedule(req.body);
  if (!data) return res.status(400).json({ error, message: error });
  const result = await pool.query(
    `UPDATE report_schedules SET
       name = $2, employee_ids = $3, frequency = $4, send_time = $5, weekday = $6, recipients = $7,
       subject_template = $8, body_template = $9, is_active = $10, combine_employees = $11, updated_at = NOW()
     WHERE id = $1
     RETURNING ${SCHEDULE_COLS}`,
    [req.params.id, data.name, data.employee_ids, data.frequency, data.send_time,
     data.frequency === "weekly" ? data.weekday : null,
     data.recipients, data.subject_template, data.body_template, data.is_active ?? true, data.combine_employees ?? false]
  );
  if (!result.rows[0]) return res.status(404).json({ error: "Not found" });
  return res.json(result.rows[0]);
});

router.delete("/schedules/:id", async (req, res) => {
  const result = await pool.query("DELETE FROM report_schedules WHERE id = $1", [req.params.id]);
  if (!result.rowCount) return res.status(404).json({ error: "Not found" });
  return res.status(204).end();
});

/** Test send: mails the period so far right now, outside the schedule and its once-a-day lock. */
router.post("/schedules/:id/send-now", async (req, res) => {
  const { rows } = await pool.query<ReportSchedule>("SELECT * FROM report_schedules WHERE id = $1", [req.params.id]);
  const s = rows[0];
  if (!s) return res.status(404).json({ error: "Not found" });

  const now = new Date();
  const win = reportWindow(s.frequency, now);
  const results = await sendScheduledReport(s, win, `manual:${now.getTime()}`);
  return res.json({ results });
});

/** A schedule's period so far (`frequency`) or an explicit `date_from`/`date_to` IST range. */
function reportPeriod(q: Record<string, unknown>) {
  const frequency = z.enum(["daily", "weekly", "monthly"]).safeParse(q.frequency);
  if (frequency.success) {
    const { start, end, label } = reportWindow(frequency.data, new Date());
    return { start, end, label, type: { daily: "Daily", weekly: "Weekly", monthly: "Monthly" }[frequency.data] };
  }
  const { start, end } = resolveRange(typeof q.date_from === "string" ? q.date_from : null, typeof q.date_to === "string" ? q.date_to : null);
  // An open-ended range ("All Time") starts at 1970; label it by its end only
  const label = start.getTime() === 0 ? `Up to ${rangeLabel(end, end)}` : rangeLabel(start, end);
  return { start, end, label, type: "Custom" };
}

/** Report input for one employee or `all` active ones over the requested period; null if the employee is unknown. */
async function loadReport(q: Record<string, unknown>): Promise<PdfInput | null | "bad-id"> {
  const who = String(q.employee_id ?? "all");
  if (who !== "all" && !z.string().uuid().safeParse(who).success) return "bad-id";
  const { start, end, label, type } = reportPeriod(q);
  const ids = who === "all"
    ? (await pool.query("SELECT id FROM employees WHERE status = 'active' ORDER BY name")).rows.map((r) => r.id)
    : [who];
  const people = (await employeesStats(ids, start, end)).map(pdfPerson);
  if (who !== "all" && !people.length) return null;
  return { title: type === "Custom" ? "Call Report" : `${type} Call Report`, period: label, people };
}

const badId = { error: "employee_id must be an id or 'all'", message: "employee_id must be an id or 'all'" };
const notFound = { error: "Employee not found", message: "Employee not found" };

/** The report dashboard's numbers (same as the emailed PDF and body). */
router.get("/data", async (req, res) => {
  const input = await loadReport(req.query);
  if (input === "bad-id") return res.status(400).json(badId);
  if (!input) return res.status(404).json(notFound);
  res.json(reportData(input));
});

/** The designed report as HTML, or `format=pdf` to download the same PDF the emails attach. */
router.get("/view", async (req, res) => {
  const input = await loadReport(req.query);
  if (input === "bad-id") return res.status(400).json(badId);
  if (!input) return res.status(404).json(notFound);
  const html = reportHtml(input);
  if (req.query.format !== "pdf") return res.type("html").send(html);
  const filename = `Call Report - ${input.period}`.replace(/[^\w .-]+/g, "-").slice(0, 120);
  res.type("pdf").attachment(`${filename}.pdf`).send(await htmlToPdf(html));
});

/**
 * Figures for one employee, as template variables. Either a schedule's period
 * so far (`frequency`) or an explicit `date_from`/`date_to` IST range.
 */
router.get("/preview", async (req, res) => {
  const employeeId = String(req.query.employee_id ?? "");
  if (!z.string().uuid().safeParse(employeeId).success) {
    return res.status(400).json({ error: "employee_id is required", message: "employee_id is required" });
  }
  const { start, end, label, type } = reportPeriod(req.query);
  const vars = await buildEmployeeReport(employeeId, start, end, type, label);
  if (!vars) return res.status(404).json({ error: "Employee not found" });
  return res.json({ vars });
});

router.get("/runs", async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  const result = await pool.query(
    `SELECT r.id, r.schedule_id, s.name AS schedule_name, r.employee_id,
            COALESCE(e.name, 'All selected (one email)') AS employee_name,
            r.period_key, r.status, r.attempts, r.error, r.sent_at, r.created_at
     FROM report_runs r
     JOIN report_schedules s ON s.id = r.schedule_id
     LEFT JOIN employees e ON e.id = r.employee_id
     ORDER BY r.created_at DESC
     LIMIT $1`,
    [limit]
  );
  return res.json(result.rows);
});

export default router;
