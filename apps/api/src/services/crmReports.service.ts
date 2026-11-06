import pool from "../db/pool";
import { istDateKey, istMidnight, istParts } from "../lib/dateRange";
import { dueSendAt } from "../lib/reportSchedule";
import { isProbableTypo } from "../lib/crm/phone";
import { KEEP_AUDIO_CODES } from "../lib/crm/rules";
import { CrmError, contradicts, getSetting } from "./crm.service";
import { sendMail } from "./mail.service";

export const LIKELY_LABEL = "Likely conversations (≥30 s, coded D/E/F/Z)";
const LIST_CAP = 200;
const DAY_MS = 86_400_000;

// ── Owner report ───────────────────────────────────────────────────────────

export async function crmReport(start: Date, end: Date) {
  const range = [start.toISOString(), end.toISOString()];
  const [reps, funnel, reasons, noRecording, noForm, typoPairs, checked, errors] = await Promise.all([
    pool.query(
      `WITH f AS (
         SELECT i.employee_id, i.code, c.duration_secs FROM lead_interactions i
         LEFT JOIN calls c ON c.id = i.call_id
         WHERE i.kind = 'call_outcome' AND i.created_at >= $1 AND i.created_at < $2),
       d AS (SELECT employee_id, count(*)::int AS dials FROM calls
             WHERE lead_id IS NOT NULL AND called_at >= $1 AND called_at < $2 GROUP BY 1)
       SELECT e.id, e.name, e.employee_code, coalesce(max(d.dials), 0)::int AS dials, count(f.code)::int AS forms,
         count(*) FILTER (WHERE f.code IN ('D','E','F','Z') AND f.duration_secs >= 30)::int AS likely,
         ${["A", "B", "C", "D", "E", "F", "Z"].map((c) => `count(*) FILTER (WHERE f.code = '${c}')::int AS "${c}"`).join(", ")}
       FROM employees e
       LEFT JOIN f ON f.employee_id = e.id
       LEFT JOIN d ON d.employee_id = e.id
       WHERE e.role = 'employee' AND e.status = 'active'
       GROUP BY e.id ORDER BY count(*) FILTER (WHERE f.code = 'F') DESC, count(f.code) DESC, e.name`,
      range
    ),
    // Distinct leads reaching each stage through forms saved in the period
    pool.query(
      `SELECT count(DISTINCT lead_id)::int AS worked,
         count(DISTINCT lead_id) FILTER (WHERE code IN ('C','D','E','F','Z'))::int AS connected,
         count(DISTINCT lead_id) FILTER (WHERE code IN ('D','E','F','Z'))::int AS talked,
         count(DISTINCT lead_id) FILTER (WHERE code IN ('E','F'))::int AS interested,
         count(DISTINCT lead_id) FILTER (WHERE code = 'F')::int AS paid
       FROM lead_interactions WHERE kind = 'call_outcome' AND created_at >= $1 AND created_at < $2`,
      range
    ),
    pool.query(
      `SELECT CASE WHEN code = 'Z' THEN 'Z' ELSE 'DE' END AS grp, coalesce(reason, '(no reason)') AS reason, count(*)::int AS n
       FROM lead_interactions WHERE kind = 'call_outcome' AND code IN ('D','E','Z') AND created_at >= $1 AND created_at < $2
       GROUP BY 1, 2 ORDER BY 1, 3 DESC`,
      range
    ),
    pool.query(
      `SELECT i.id, i.created_at, i.code, i.reason, l.id AS lead_id, l.lead_code, l.name AS lead_name, l.phone10, e.name AS rep
       FROM lead_interactions i JOIN leads l ON l.id = i.lead_id LEFT JOIN employees e ON e.id = i.employee_id
       WHERE i.kind = 'call_outcome' AND i.call_id IS NULL AND i.created_at >= $1 AND i.created_at < $2
       ORDER BY i.created_at DESC LIMIT ${LIST_CAP}`,
      range
    ),
    // Only numbers that are leads: calls to unknown numbers are not flagged
    pool.query(
      `SELECT c.id, c.called_at, c.duration_secs, l.id AS lead_id, l.lead_code, l.name AS lead_name, l.phone10, e.name AS rep
       FROM calls c JOIN leads l ON l.phone10 = c.phone10 LEFT JOIN employees e ON e.id = c.employee_id
       WHERE c.called_at >= $1 AND c.called_at < $2 AND c.called_at >= l.created_at
         AND NOT EXISTS (SELECT 1 FROM lead_interactions i WHERE i.call_id = c.id)
       ORDER BY c.called_at DESC LIMIT ${LIST_CAP}`,
      range
    ),
    pool.query(
      `SELECT i.id AS interaction_id, i.created_at, i.code, l.id AS lead_id, l.lead_code, l.name AS lead_name,
              l.phone10 AS form_phone, c.id AS call_id, c.phone10 AS call_phone, c.called_at, c.duration_secs, e.name AS rep
       FROM lead_interactions i
       JOIN leads l ON l.id = i.lead_id
       JOIN calls c ON c.employee_id = i.employee_id
        AND c.called_at BETWEEN i.created_at - interval '30 minutes' AND i.created_at + interval '30 minutes'
        AND length(c.phone10) = 10 AND c.phone10 <> l.phone10
        AND NOT EXISTS (SELECT 1 FROM lead_interactions x WHERE x.call_id = c.id)
       LEFT JOIN employees e ON e.id = i.employee_id
       WHERE i.kind = 'call_outcome' AND i.call_id IS NULL AND i.created_at >= $1 AND i.created_at < $2`,
      range
    ),
    pool.query(
      `SELECT i.id, i.created_at, i.code, i.reason, cc.label AS check_label, cc.confidence, c.duration_secs,
              l.id AS lead_id, l.lead_code, l.name AS lead_name, e.name AS rep
       FROM lead_interactions i JOIN call_checks cc ON cc.call_id = i.call_id
       JOIN calls c ON c.id = i.call_id JOIN leads l ON l.id = i.lead_id LEFT JOIN employees e ON e.id = i.employee_id
       WHERE i.created_at >= $1 AND i.created_at < $2`,
      range
    ),
    pool.query(
      `SELECT count(*)::int AS total, count(*) FILTER (WHERE created_at > NOW() - interval '24 hours')::int AS last_24h,
              (SELECT json_agg(x) FROM (SELECT call_id, error, created_at FROM crm_match_errors ORDER BY id DESC LIMIT 5) x) AS latest
       FROM crm_match_errors`
    ),
  ]);

  const checkMode = (await getSetting<{ mode: string }>("call_check", { mode: "preview" })).mode;
  const group = (g: string) => {
    const rows = reasons.rows.filter((r) => r.grp === g);
    const total = rows.reduce((a, r) => a + r.n, 0);
    return rows.map((r) => ({ reason: r.reason, n: r.n, share: total ? r.n / total : 0 }));
  };
  return {
    likely_label: LIKELY_LABEL,
    reps: reps.rows,
    funnel: funnel.rows[0],
    reasons: { z: group("Z"), de: group("DE") },
    mismatches: {
      forms_without_recording: noRecording.rows,
      recordings_without_form: noForm.rows,
      probable_typos: typoPairs.rows.filter((r) => isProbableTypo(r.form_phone, r.call_phone)),
    },
    contradictions: checkMode === "off" ? [] : checked.rows.filter((r) => contradicts(r.code, r.check_label)),
    call_check_mode: checkMode,
    match_errors: errors.rows[0],
  };
}

/** "Link these?" from the typo report: attach a recording to a form, never merging numbers. */
export async function linkPair(interactionId: string, callId: string) {
  const { rows } = await pool.query(
    `UPDATE lead_interactions i SET call_id = $2
     WHERE i.id = $1 AND i.kind = 'call_outcome' AND i.call_id IS NULL
       AND NOT EXISTS (SELECT 1 FROM lead_interactions x WHERE x.call_id = $2)
     RETURNING i.code, i.lead_id`,
    [interactionId, callId]
  );
  if (!rows[0]) throw new CrmError(409, "One of these is already linked");
  await pool.query(
    "UPDATE calls SET keep_audio = keep_audio OR $2 WHERE id = $1",
    [callId, (KEEP_AUDIO_CODES as readonly string[]).includes(rows[0].code)]
  );
}

// ── F digest ───────────────────────────────────────────────────────────────

export async function digestData(day: Date) {
  const p = istParts(day);
  const start = istMidnight(p.year, p.month, p.day);
  const { rows } = await pool.query(
    `SELECT i.id, i.created_at, i.reason, i.note, (i.meta ->> 'amount')::numeric AS amount, i.call_id,
            c.duration_secs, l.id AS lead_id, l.lead_code, l.name AS lead_name, l.phone10, e.name AS rep
     FROM lead_interactions i JOIN leads l ON l.id = i.lead_id
     LEFT JOIN employees e ON e.id = i.employee_id LEFT JOIN calls c ON c.id = i.call_id
     WHERE i.code = 'F' AND i.created_at >= $1 AND i.created_at < $2 ORDER BY i.created_at`,
    [start.toISOString(), new Date(start.getTime() + DAY_MS).toISOString()]
  );
  const label = start.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" });
  return { label, day_key: istDateKey(day), rows, missing: rows.filter((r) => !r.call_id).length };
}

const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const durText = (s: number | null) => (s == null ? "—" : s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`);

export const dashboardBase = () => (process.env.WEB_ORIGIN || "http://localhost:3000").split(",")[0].trim().replace(/\/$/, "");

/** Email-safe HTML (tables + inline styles) in the report palette. */
export function digestHtml(d: Awaited<ReturnType<typeof digestData>>, base = dashboardBase()): string {
  const total = d.rows.reduce((a, r) => a + Number(r.amount ?? 299), 0);
  const rows = d.rows.map((r) => {
    const t = new Date(r.created_at).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", hour12: true });
    const flag = r.call_id ? "" : `<span style="display:inline-block;background:#f8e3df;color:#b33a2e;font-weight:700;font-size:11px;padding:2px 8px;border-radius:999px">! No recording</span>`;
    return `<tr>
      <td style="padding:10px;border-bottom:1px solid #f1e8da"><a href="${esc(base)}/dashboard/crm?lead=${esc(r.lead_id)}" style="color:#2b2118;font-weight:700;text-decoration:none">${esc(r.lead_code)}</a><div style="color:#7a6a58;font-size:12px">${esc(r.lead_name)}</div></td>
      <td style="padding:10px;border-bottom:1px solid #f1e8da">${esc(r.rep)}</td>
      <td style="padding:10px;border-bottom:1px solid #f1e8da">${esc(t)}</td>
      <td style="padding:10px;border-bottom:1px solid #f1e8da">${r.call_id ? esc(durText(r.duration_secs)) : flag}</td>
      <td style="padding:10px;border-bottom:1px solid #f1e8da;text-align:right;font-weight:700">₹${esc(Number(r.amount ?? 299))}</td></tr>`;
  }).join("");
  return `<!doctype html><html><body style="margin:0;background:#f3ece0;font-family:'DM Sans',Arial,sans-serif;color:#2b2118">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3ece0;padding:24px 0"><tr><td align="center">
  <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%">
    <tr><td style="background:linear-gradient(150deg,#3b2a1e,#5a4231);background-color:#3b2a1e;color:#fff;border-radius:14px;padding:20px 22px">
      <div style="color:#e3b778;font-size:11px;letter-spacing:.12em;text-transform:uppercase;font-weight:700">CRM · Daily paid digest</div>
      <div style="font-size:22px;font-weight:800;margin-top:4px">${d.rows.length} paid trial${d.rows.length === 1 ? "" : "s"} · ₹${total}</div>
      <div style="font-size:13px;opacity:.85;margin-top:2px">${esc(d.label)}${d.missing ? ` · <b style="color:#e3b778">${d.missing} without a matched recording</b>` : ""}</div>
    </td></tr>
    <tr><td style="height:14px"></td></tr>
    <tr><td style="background:#fffdf8;border:1px solid #e7dccb;border-radius:14px;padding:16px 18px">
      ${d.rows.length ? `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13.5px">
        <thead><tr>${["Lead", "Rep", "Time", "Matched call", "Amount"].map((h, i) => `<th style="text-align:${i === 4 ? "right" : "left"};font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;color:#7a6a58;background:#f7f0e5;padding:9px 10px">${h}</th>`).join("")}</tr></thead>
        <tbody>${rows}</tbody></table>`
      : `<p style="margin:0;color:#7a6a58">No paid trials were recorded on this day.</p>`}
      <p style="margin:12px 0 0;font-size:12px;color:#7a6a58">Open a lead to hear its recording in the dashboard. Flagged rows have no recording matched to the form yet.</p>
    </td></tr>
  </table></td></tr></table></body></html>`;
}

export function digestText(d: Awaited<ReturnType<typeof digestData>>, base = dashboardBase()): string {
  const lines = d.rows.map((r) => `${r.lead_code} ${r.lead_name} — ${r.rep} — ${r.call_id ? durText(r.duration_secs) : "NO RECORDING"} — ${base}/dashboard/crm?lead=${r.lead_id}`);
  return `Paid trials ${d.label}: ${d.rows.length}${d.missing ? ` (${d.missing} without a recording)` : ""}\n\n${lines.join("\n") || "None."}`;
}

async function digestRecipients(): Promise<string[]> {
  const s = await getSetting<{ recipients: string[] }>("digest", { recipients: [] });
  if (s.recipients?.length) return s.recipients;
  const { rows } = await pool.query("SELECT email FROM employees WHERE role = 'owner' AND status = 'active'");
  return rows.map((r) => r.email);
}

/** Claim the day (crm_digest_runs PK is the lock) and mail it. Same retry rules as report_runs. */
export async function sendDigest(day: Date) {
  const d = await digestData(day);
  const claim = await pool.query(
    `INSERT INTO crm_digest_runs (period_key, status) VALUES ($1, 'sending')
     ON CONFLICT (period_key) DO UPDATE SET status = 'sending', attempts = crm_digest_runs.attempts + 1, error = NULL, updated_at = NOW()
       WHERE crm_digest_runs.attempts < 3 AND (
         (crm_digest_runs.status = 'failed'  AND crm_digest_runs.updated_at < NOW() - interval '10 minutes') OR
         (crm_digest_runs.status = 'sending' AND crm_digest_runs.updated_at < NOW() - interval '15 minutes'))
     RETURNING period_key`,
    [d.day_key]
  );
  if (!claim.rows[0]) return "skipped";
  try {
    const to = await digestRecipients();
    if (!to.length) throw new Error("No owner email to send the digest to");
    await sendMail({ to, subject: `Paid trials — ${d.label} (${d.rows.length})`, text: digestText(d), html: digestHtml(d) });
    await pool.query("UPDATE crm_digest_runs SET status = 'sent', sent_at = NOW(), updated_at = NOW() WHERE period_key = $1", [d.day_key]);
    return "sent";
  } catch (e) {
    await pool.query("UPDATE crm_digest_runs SET status = 'failed', error = $2, updated_at = NOW() WHERE period_key = $1", [d.day_key, String((e as Error).message).slice(0, 500)]);
    throw e;
  }
}

/**
 * 60 s tick, production only (a laptop on the same database must never claim
 * the day), and only when the CRM is switched on.
 */
export function startDigestScheduler() {
  if (process.env.NODE_ENV !== "production" || process.env.CRM_ENABLED !== "true") return;
  const tick = async () => {
    const s = await getSetting<{ send_time: string }>("digest", { send_time: "21:00" });
    const at = dueSendAt({ frequency: "daily", send_time: s.send_time, weekday: null }, new Date());
    if (at) await sendDigest(at);
  };
  setInterval(() => tick().catch((e) => console.error("[crm] digest tick failed:", e)), 60_000);
}
