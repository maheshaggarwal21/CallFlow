import pool from "../db/pool";
import { IST_TZ } from "../lib/dateRange";
import { dueSendAt, reportWindow, type Frequency } from "../lib/reportSchedule";
import { sendMail } from "./mail.service";
import { textToPdf } from "../lib/textPdf";
import { htmlToPdf, reportHtml, svgToPng, type PdfInput, type PdfPerson } from "../lib/reportPdf";
import { dropCharts, reportEmailHtml } from "../lib/reportEmail";

// Client rule (Nov 2026): 0 + 10 digits, 91 + 10 digits (inbound caller ID), or
// a bare 10-digit mobile. Checked against live data: "0 + 9 digit" numbers are
// mostly the recorder dropping a digit, so they stay invalid here but are
// counted under "10 digits" where the client can see them.
const VALID_NUMBER = String.raw`^(0\d{10}|91\d{10}|[6-9]\d{9})$`;

export type ReportSchedule = {
  id: string;
  name: string;
  employee_ids: string[];
  frequency: Frequency;
  send_time: string;
  weekday: number | null;
  recipients: string[];
  subject_template: string;
  body_template: string;
  combine_employees: boolean;
  is_active: boolean;
};

type Window = { start: Date; end: Date; label: string };
type SendResult = { employee_id: string | null; status: "sent" | "failed" | "skipped"; error?: string };

// Between employees in a combined email
const SEPARATOR = "\n\n" + "─".repeat(40) + "\n\n";

const REPORT_TYPE: Record<Frequency, string> = { daily: "Daily", weekly: "Weekly", monthly: "Monthly" };

/** Seconds → HH:MM:SS (hours can exceed 24 on monthly totals). */
export function hms(secs: number | null): string {
  if (secs === null || !Number.isFinite(secs)) return "—";
  const s = Math.max(0, Math.round(secs));
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}

/** `{{var}}` substitution; unknown names stay as-is so a typo is visible in the mail. */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) => (k in vars ? vars[k] : m));
}

/**
 * Every figure the report can show, as display strings keyed by template
 * variable name. Null when the employee no longer exists.
 */
export async function buildEmployeeReport(
  employeeId: string, start: Date, end: Date, reportType: string, periodLabel: string
): Promise<Record<string, string> | null> {
  const s = await employeeStats(employeeId, start, end);
  return s && reportVars(s, reportType, periodLabel);
}

type EmployeeStats = { id: string; name: string; employee_code: number; lines: string | null; r: any; hours: number[] };

/** Raw figures for one employee over [start, end). Null when the employee no longer exists. */
export async function employeeStats(employeeId: string, start: Date, end: Date): Promise<EmployeeStats | null> {
  // The three queries are independent: run them together (each is a ~110 ms trip to the database)
  const range = [employeeId, start.toISOString(), end.toISOString()];
  const [emp, { rows: [r] }, byHour] = await Promise.all([pool.query(
    `SELECT e.name, e.employee_code,
            (SELECT string_agg(line_number, ', ' ORDER BY line_number) FROM lines WHERE employee_id = e.id) AS lines
     FROM employees e WHERE e.id = $1`,
    [employeeId]
  ),

  // Every call counts, including <10 s ones (the client wants them in the totals
  // AND as their own line). Gap = end of one call → start of the next, within
  // one IST day, so overnight breaks and overlapping calls don't count.
  pool.query(
    `WITH c AS (
       SELECT duration_secs, call_direction AS dir,
              regexp_replace(COALESCE(caller_phone, ''), '\\D', '', 'g') AS d,
              EXTRACT(EPOCH FROM called_at - LAG(called_at + make_interval(secs => duration_secs))
                OVER (PARTITION BY (called_at AT TIME ZONE '${IST_TZ}')::date ORDER BY called_at)) AS gap
       FROM calls WHERE employee_id = $1 AND called_at >= $2 AND called_at < $3
     )
     SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE dir = 'inbound')::int  AS inbound,
            COUNT(*) FILTER (WHERE dir = 'outbound')::int AS outbound,
            COALESCE(SUM(duration_secs), 0)::int AS total_secs,
            AVG(duration_secs)::float AS avg_secs,
            COUNT(*) FILTER (WHERE duration_secs < 10)::int AS under_10s,
            COUNT(*) FILTER (WHERE dir = 'outbound' AND d <> '' AND d !~ '${VALID_NUMBER}')::int AS invalid_out,
            COUNT(*) FILTER (WHERE dir = 'inbound'  AND d <> '' AND d !~ '${VALID_NUMBER}')::int AS invalid_in,
            COUNT(*) FILTER (WHERE duration_secs < 30)::int AS b_lt_30s,
            COUNT(*) FILTER (WHERE duration_secs >= 30  AND duration_secs < 60)::int  AS b_30_60s,
            COUNT(*) FILTER (WHERE duration_secs >= 60  AND duration_secs < 120)::int AS b_1_2m,
            COUNT(*) FILTER (WHERE duration_secs >= 120 AND duration_secs < 180)::int AS b_2_3m,
            COUNT(*) FILTER (WHERE duration_secs >= 180 AND duration_secs < 300)::int AS b_3_5m,
            COUNT(*) FILTER (WHERE duration_secs >= 300 AND duration_secs < 600)::int AS b_5_10m,
            COUNT(*) FILTER (WHERE duration_secs >= 600 AND duration_secs < 900)::int AS b_10_15m,
            COUNT(*) FILTER (WHERE duration_secs >= 900)::int AS b_gt_15m,
            COUNT(*) FILTER (WHERE dir = 'inbound'  AND length(d) = 10)::int AS d10_in,
            COUNT(*) FILTER (WHERE dir = 'outbound' AND length(d) = 10)::int AS d10_out,
            COUNT(*) FILTER (WHERE dir = 'inbound'  AND length(d) = 11)::int AS d11_in,
            COUNT(*) FILTER (WHERE dir = 'outbound' AND length(d) = 11)::int AS d11_out,
            COUNT(*) FILTER (WHERE dir = 'inbound'  AND length(d) = 12)::int AS d12_in,
            COUNT(*) FILTER (WHERE dir = 'outbound' AND length(d) = 12)::int AS d12_out,
            COUNT(*) FILTER (WHERE dir = 'inbound'  AND d <> '' AND length(d) NOT IN (10, 11, 12))::int AS dother_in,
            COUNT(*) FILTER (WHERE dir = 'outbound' AND d <> '' AND length(d) NOT IN (10, 11, 12))::int AS dother_out,
            COUNT(*) FILTER (WHERE d = '')::int AS no_number,
            MIN(gap) FILTER (WHERE gap > 0)::float AS min_gap,
            MAX(gap) FILTER (WHERE gap > 0)::float AS max_gap
     FROM c`,
    range
  ),
  pool.query(
    `SELECT EXTRACT(HOUR FROM called_at AT TIME ZONE '${IST_TZ}')::int AS h, COUNT(*)::int AS n
     FROM calls WHERE employee_id = $1 AND called_at >= $2 AND called_at < $3 GROUP BY 1`,
    range
  )]);
  if (!emp.rows[0]) return null;
  const hours = Array<number>(24).fill(0);
  for (const row of byHour.rows) hours[row.h] = row.n;
  return { ...emp.rows[0], id: employeeId, r, hours };
}

/** Stats for several employees at once, in the given order; unknown ids are left out. */
export async function employeesStats(ids: string[], start: Date, end: Date): Promise<EmployeeStats[]> {
  const all = await Promise.all(ids.map((id) => employeeStats(id, start, end)));
  return all.filter((st): st is EmployeeStats => st !== null);
}

function reportVars(s: EmployeeStats, reportType: string, periodLabel: string): Record<string, string> {
  const r = s.r;
  const n = (k: string) => String(r[k]);
  return {
    report_type: reportType,
    period: periodLabel,
    name: s.name,
    employee_id: String(s.employee_code),
    lines: s.lines ?? "—",
    total_calls: n("total"),
    inbound: n("inbound"),
    outbound: n("outbound"),
    total_duration: hms(r.total_secs),
    avg_duration: hms(r.avg_secs),
    calls_under_10s: n("under_10s"),
    invalid_numbers: n("invalid_out"),
    invalid_inbound: n("invalid_in"),
    b_lt_30s: n("b_lt_30s"),
    b_30_60s: n("b_30_60s"),
    b_1_2m: n("b_1_2m"),
    b_2_3m: n("b_2_3m"),
    b_3_5m: n("b_3_5m"),
    b_5_10m: n("b_5_10m"),
    b_10_15m: n("b_10_15m"),
    b_gt_15m: n("b_gt_15m"),
    d10_in: n("d10_in"), d10_out: n("d10_out"),
    d11_in: n("d11_in"), d11_out: n("d11_out"),
    d12_in: n("d12_in"), d12_out: n("d12_out"),
    dother_in: n("dother_in"), dother_out: n("dother_out"),
    no_number: n("no_number"),
    min_gap: hms(r.min_gap),
    max_gap: hms(r.max_gap),
  };
}

export function pdfPerson(s: EmployeeStats): PdfPerson {
  const r = s.r;
  return {
    id: s.id, name: s.name, code: String(s.employee_code), line: s.lines ?? "—",
    calls: r.total, inb: r.inbound, out: r.outbound, dur: r.total_secs, avg: Math.round(r.avg_secs ?? 0), lt10: r.under_10s,
    gapMin: r.min_gap, gapMax: r.max_gap, invalid: r.invalid_out,
    len: [[r.d10_in, r.d10_out], [r.d11_in, r.d11_out], [r.d12_in, r.d12_out], [r.dother_in, r.dother_out]],
    b: [r.b_lt_30s, r.b_30_60s, r.b_1_2m, r.b_2_3m, r.b_3_5m, r.b_5_10m, r.b_10_15m, r.b_gt_15m],
    hours: s.hours,
  };
}

/** The designed PDF; the plain-text one if Chrome is missing or fails, so the mail still goes out. */
export async function attachmentPdf(design: PdfInput, bodies: string[]): Promise<Buffer> {
  try {
    return await htmlToPdf(reportHtml(design));
  } catch (e) {
    console.error("[reports] designed PDF failed, attaching text PDF instead:", e);
    return textToPdf(bodies);
  }
}

/**
 * Designed email body with its hourly charts as inline PNGs; a chart that fails to render is left out,
 * and if the design itself fails the plain template text is sent as before.
 */
export async function designedEmail(design: PdfInput): Promise<{ html?: string; images: { filename: string; content: Buffer; contentId: string }[] }> {
  let built: ReturnType<typeof reportEmailHtml>;
  try {
    built = reportEmailHtml(design);
  } catch (e) {
    console.error("[reports] designed email failed, sending plain text:", e);
    return { images: [] };
  }
  const { html, charts } = built;
  const images: { filename: string; content: Buffer; contentId: string }[] = [];
  const failed: string[] = [];
  for (const c of charts) {
    try {
      images.push({ filename: `${c.cid}.png`, content: await svgToPng(c.svg, c.width, c.height), contentId: c.cid });
    } catch (e) {
      failed.push(c.cid);
      console.error(`[reports] chart ${c.cid} failed, sending without it:`, e);
    }
  }
  return { html: dropCharts(html, failed), images };
}

/**
 * Mail a schedule's reports for one period: one email per active employee, or
 * one combined email (logged as a single run with employee_id NULL).
 */
export async function sendScheduledReport(s: ReportSchedule, window: Window, periodKey: string): Promise<SendResult[]> {
  const ids = await activeEmployeeIds(s.employee_ids);
  if (!ids.length) return [];
  if (s.combine_employees) return [await deliver(s, null, ids, window, periodKey)];
  const results: SendResult[] = [];
  for (const id of ids) {
    // One bad send must not stop the rest
    results.push(await deliver(s, id, [id], window, periodKey).catch((e) => {
      console.error(`[reports] ${s.name} → ${id}:`, e);
      return { employee_id: id, status: "failed" as const, error: String(e?.message ?? e) };
    }));
  }
  return results;
}

/**
 * Claim, build and mail one email. The INSERT … ON CONFLICT is the lock: only
 * the caller that gets a row back sends. A failed (or crashed mid-send) run is
 * retried after 10 minutes, at most 3 attempts in total.
 */
async function deliver(
  s: ReportSchedule, runEmployeeId: string | null, employeeIds: string[], window: Window, periodKey: string
): Promise<SendResult> {
  const claim = await pool.query(
    `INSERT INTO report_runs (schedule_id, employee_id, period_key, status)
     VALUES ($1, $2, $3, 'sending')
     ON CONFLICT (schedule_id, employee_id, period_key) DO UPDATE
       SET status = 'sending', attempts = report_runs.attempts + 1, error = NULL, updated_at = NOW()
       WHERE report_runs.attempts < 3 AND (
         (report_runs.status = 'failed'  AND report_runs.updated_at < NOW() - interval '10 minutes') OR
         (report_runs.status = 'sending' AND report_runs.updated_at < NOW() - interval '15 minutes'))
     RETURNING id`,
    [s.id, runEmployeeId, periodKey]
  );
  const runId = claim.rows[0]?.id;
  if (!runId) return { employee_id: runEmployeeId, status: "skipped" };

  try {
    const stats = await employeesStats(employeeIds, window.start, window.end);
    if (!stats.length) throw new Error("Employee no longer exists");
    const reports = stats.map((st) => reportVars(st, REPORT_TYPE[s.frequency], window.label));
    // Combined subject lists everyone in {{name}}; other variables come from the first report
    const subjectVars = { ...reports[0], name: reports.map((r) => r.name).join(", ") };
    const subject = renderTemplate(s.subject_template, subjectVars);
    const bodies = reports.map((v) => renderTemplate(s.body_template, v));
    const design = { title: `${REPORT_TYPE[s.frequency]} Call Report`, period: window.label, people: stats.map(pdfPerson) };
    const email = await designedEmail(design);
    await sendMail({
      to: s.recipients,
      subject,
      text: bodies.join(SEPARATOR), // the template text stays as the plain-text part
      html: email.html,
      attachments: [
        ...email.images,
        {
          filename: `${subject.replace(/[^\w .-]+/g, "-").trim().slice(0, 120) || "Report"}.pdf`,
          content: await attachmentPdf(design, bodies),
        },
      ],
    });
    await pool.query(
      "UPDATE report_runs SET status = 'sent', stats = $2, sent_at = NOW(), updated_at = NOW() WHERE id = $1",
      [runId, JSON.stringify(runEmployeeId ? reports[0] : reports)]
    );
    return { employee_id: runEmployeeId, status: "sent" };
  } catch (err: any) {
    const error = String(err?.message ?? err).slice(0, 500);
    await pool.query(
      "UPDATE report_runs SET status = 'failed', error = $2, updated_at = NOW() WHERE id = $1",
      [runId, error]
    );
    console.error(`[reports] ${s.name} → ${runEmployeeId ?? "combined"} failed: ${error}`);
    return { employee_id: runEmployeeId, status: "failed", error };
  }
}

async function runDueReports(now = new Date()) {
  const { rows } = await pool.query<ReportSchedule>(
    "SELECT * FROM report_schedules WHERE is_active"
  );
  for (const s of rows) {
    const sendAt = dueSendAt(s, now);
    if (!sendAt) continue;
    const win = reportWindow(s.frequency, sendAt);
    await sendScheduledReport(s, win, win.periodKey)
      .catch((e) => console.error(`[reports] ${s.name}:`, e));
  }
}

/** Selected employees that still exist and are active (deleted/left ones are skipped). */
export async function activeEmployeeIds(ids: string[]): Promise<string[]> {
  const { rows } = await pool.query(
    "SELECT id FROM employees WHERE id = ANY($1::uuid[]) AND status = 'active' ORDER BY name",
    [ids]
  );
  return rows.map((r) => r.id);
}

/**
 * 60 s tick inside the API process. Production only: a laptop pointed at the
 * same database must never claim (and then console-"send") a real report.
 */
export function startReportScheduler() {
  if (process.env.NODE_ENV !== "production") {
    console.log("[reports] scheduler disabled outside production (Send now still works)");
    return;
  }
  const tick = () => runDueReports().catch((e) => console.error("[reports] tick failed:", e));
  setInterval(tick, 60_000);
  tick();
}
