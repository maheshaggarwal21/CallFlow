import { Router } from "express";
import pool from "../db/pool";
import { requireAuth } from "../middleware/auth";
import { requireOwner } from "../middleware/requireOwner";

const router = Router();

router.use(requireAuth);

function parseMonth(month?: string) {
  if (!month) return null;
  const parts = month.split("-");
  if (parts.length !== 2) return null;
  const year = Number(parts[0]);
  const monthIndex = Number(parts[1]) - 1;
  if (Number.isNaN(year) || Number.isNaN(monthIndex) || monthIndex < 0 || monthIndex > 11) {
    return null;
  }
  const start = new Date(Date.UTC(year, monthIndex, 1, 0, 0, 0));
  const end = new Date(Date.UTC(year, monthIndex + 1, 1, 0, 0, 0));
  return { start, end };
}

function getWeekRange() {
  const now = new Date();
  const utc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = utc.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day; // Monday start
  const start = new Date(utc);
  start.setUTCDate(utc.getUTCDate() + diff);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 7);
  return { start, end };
}

router.get("/misc-count", async (_req, res) => {
  const result = await pool.query(
    "SELECT " +
      "COUNT(*) AS count, " +
      "COALESCE(ROUND(AVG(duration_secs)), 0) AS avg_duration_secs, " +
      "COUNT(*) FILTER (WHERE misc_reason ILIKE '%disconnect%') AS disconnected_count, " +
      "COUNT(*) FILTER (WHERE misc_reason ILIKE '%no answer%' OR misc_reason ILIKE '%no response%') AS no_response_count " +
    "FROM calls WHERE is_misc = TRUE"
  );

  return res.json(result.rows[0]);
});

router.get("/overview", requireOwner, async (req, res) => {
  const monthParam = typeof req.query.month === "string" ? req.query.month : undefined;
  const monthRange = parseMonth(monthParam);
  const now = new Date();
  const start = monthRange?.start || new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = monthRange?.end || new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

  const prevStart = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - 1, 1));
  const prevEnd = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));

  const [totalsRes, prevRes] = await Promise.all([
    pool.query(
      "SELECT " +
        "COUNT(*) AS total, " +
        "COUNT(*) FILTER (WHERE call_direction='inbound') AS inbound, " +
        "COUNT(*) FILTER (WHERE call_direction='outbound') AS outbound, " +
        "COALESCE(ROUND(AVG(duration_secs)), 0) AS avg_duration_secs " +
      "FROM calls WHERE is_misc = FALSE AND called_at >= $1 AND called_at < $2",
      [start.toISOString(), end.toISOString()]
    ),
    pool.query(
      "SELECT " +
        "COUNT(*) AS total, " +
        "COUNT(*) FILTER (WHERE call_direction='inbound') AS inbound, " +
        "COUNT(*) FILTER (WHERE call_direction='outbound') AS outbound, " +
        "COALESCE(ROUND(AVG(duration_secs)), 0) AS avg_duration_secs " +
      "FROM calls WHERE is_misc = FALSE AND called_at >= $1 AND called_at < $2",
      [prevStart.toISOString(), prevEnd.toISOString()]
    ),
  ]);

  const totals = totalsRes.rows[0];
  const prev = prevRes.rows[0];

  const totalCalls = Number(totals.total || 0);
  const inbound = Number(totals.inbound || 0);
  const outbound = Number(totals.outbound || 0);
  const avgDuration = Number(totals.avg_duration_secs || 0);

  const prevTotal = Number(prev.total || 0);
  const prevInbound = Number(prev.inbound || 0);
  const prevOutbound = Number(prev.outbound || 0);
  const prevAvg = Number(prev.avg_duration_secs || 0);

  const momDelta = {
    total_pct: prevTotal > 0 ? Math.round(((totalCalls - prevTotal) / prevTotal) * 100) : null,
    inbound_pct: prevInbound > 0 ? Math.round(((inbound - prevInbound) / prevInbound) * 100) : null,
    outbound_pct: prevOutbound > 0 ? Math.round(((outbound - prevOutbound) / prevOutbound) * 100) : null,
    avg_duration_secs: Math.round(avgDuration - prevAvg),
  };

  const directionSplit = {
    inbound_pct: totalCalls > 0 ? Math.round((inbound / totalCalls) * 100) : 0,
    outbound_pct: totalCalls > 0 ? Math.round((outbound / totalCalls) * 100) : 0,
  };

  const teamRes = await pool.query(
    "SELECT c.employee_id, e.name, e.color_index, COUNT(*) AS count, " +
      "ROUND(100.0 * COUNT(*) / NULLIF(SUM(COUNT(*)) OVER (), 0)) AS pct " +
    "FROM calls c " +
    "JOIN employees e ON e.id = c.employee_id " +
    "WHERE c.is_misc = FALSE AND c.called_at >= $1 AND c.called_at < $2 " +
    "GROUP BY c.employee_id, e.name, e.color_index " +
    "ORDER BY count DESC",
    [start.toISOString(), end.toISOString()]
  );

  const { start: weekStart, end: weekEnd } = getWeekRange();
  const weeklyRes = await pool.query(
    "SELECT date_trunc('day', called_at) AS day, " +
      "COUNT(*) FILTER (WHERE call_direction='inbound') AS inbound, " +
      "COUNT(*) FILTER (WHERE call_direction='outbound') AS outbound " +
    "FROM calls " +
    "WHERE is_misc = FALSE AND called_at >= $1 AND called_at < $2 " +
    "GROUP BY day ORDER BY day ASC",
    [weekStart.toISOString(), weekEnd.toISOString()]
  );

  const weeklyMap = new Map<string, { inbound: number; outbound: number }>();
  weeklyRes.rows.forEach((row) => {
    const key = new Date(row.day).toISOString().slice(0, 10);
    weeklyMap.set(key, { inbound: Number(row.inbound || 0), outbound: Number(row.outbound || 0) });
  });

  const weekLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const weeklyActivity = weekLabels.map((label, idx) => {
    const day = new Date(weekStart);
    day.setUTCDate(weekStart.getUTCDate() + idx);
    const key = day.toISOString().slice(0, 10);
    const data = weeklyMap.get(key) || { inbound: 0, outbound: 0 };
    return { day_label: label, inbound: data.inbound, outbound: data.outbound };
  });

  const employeeScope = typeof req.query.employee_id === "string" ? req.query.employee_id : null;
  const csatRes = await pool.query(
    "SELECT " +
      "ROUND(100.0 * COUNT(*) FILTER (WHERE sentiment = 'positive') / " +
      "NULLIF(COUNT(*) FILTER (WHERE ai_status = 'done'), 0)) AS csat_score " +
    "FROM calls " +
    "WHERE is_misc = FALSE AND called_at >= $1 AND called_at < $2 " +
    (employeeScope ? "AND employee_id = $3" : ""),
    employeeScope ? [start.toISOString(), end.toISOString(), employeeScope] : [start.toISOString(), end.toISOString()]
  );

  const resRes = await pool.query(
    "SELECT " +
      "COUNT(*) FILTER (WHERE resolution_status = 'resolved') AS resolved_count, " +
      "COUNT(*) FILTER (WHERE resolution_status = 'escalated') AS escalated_count " +
    "FROM calls WHERE is_misc = FALSE AND called_at >= $1 AND called_at < $2",
    [start.toISOString(), end.toISOString()]
  );

  const topLineRes = await pool.query(
    "SELECT line_number, COUNT(*) AS call_count " +
    "FROM calls " +
    "WHERE is_misc = FALSE AND line_number IS NOT NULL AND called_at >= $1 AND called_at < $2 " +
    "GROUP BY line_number ORDER BY call_count DESC LIMIT 1",
    [start.toISOString(), end.toISOString()]
  );

  const lineStatusRes = await pool.query(
    "SELECT l.line_number AS line, e.name AS employee_name, COALESCE(c.cnt, 0) AS call_count_today " +
    "FROM lines l " +
    "LEFT JOIN employees e ON e.id = l.employee_id " +
    "LEFT JOIN ( " +
      "SELECT line_number, COUNT(*) AS cnt " +
      "FROM calls " +
      "WHERE line_number IS NOT NULL " +
        "AND called_at >= CURRENT_DATE " +
        "AND called_at < CURRENT_DATE + INTERVAL '1 day' " +
      "GROUP BY line_number " +
    ") c ON c.line_number = l.line_number " +
    "ORDER BY l.line_number ASC"
  );

  const recentRes = await pool.query(
    "SELECT c.id, c.source, c.device_id, c.line_number, c.intercom_code, " +
      "c.call_direction, c.caller_phone, c.student_name, c.called_at, c.duration_secs, " +
      "c.employee_id, c.is_misc, c.misc_reason, c.resolution_status, c.ai_status, " +
      "c.summary, c.transcript_raw, c.transcript_json, c.sentiment, c.created_at, c.updated_at, " +
      "i.phone_number AS intercom_phone_number, " +
      "CASE WHEN c.source = 'korecall' THEN 'KoreCall' ELSE COALESCE(d.device_name, 'Android') END AS source_label, " +
      "e.color_index AS color_index, e.name AS employee_name " +
    "FROM calls c " +
    "LEFT JOIN intercoms i ON i.intercom_code = c.intercom_code " +
    "LEFT JOIN devices d ON d.id = c.device_id " +
    "LEFT JOIN employees e ON e.id = c.employee_id " +
    "WHERE c.is_misc = FALSE AND c.called_at >= $1 AND c.called_at < $2 " +
    "ORDER BY c.called_at DESC LIMIT 5",
    [start.toISOString(), end.toISOString()]
  );

  return res.json({
    total_calls: totalCalls,
    inbound,
    outbound,
    avg_duration_secs: avgDuration,
    mom_delta: momDelta,
    direction_split: directionSplit,
    team_split: teamRes.rows.map((r) => ({
      employee_id: r.employee_id,
      name: r.name,
      count: Number(r.count || 0),
      pct: Number(r.pct || 0),
      color_index: Number(r.color_index || 0),
    })),
    weekly_activity: weeklyActivity,
    csat_score: Number(csatRes.rows[0]?.csat_score || 0),
    resolved_count: Number(resRes.rows[0]?.resolved_count || 0),
    escalated_count: Number(resRes.rows[0]?.escalated_count || 0),
    top_line: topLineRes.rows[0]
      ? { line_number: topLineRes.rows[0].line_number, call_count: Number(topLineRes.rows[0].call_count) }
      : null,
    line_status: lineStatusRes.rows.map((r) => ({
      line: r.line,
      employee_name: r.employee_name,
      call_count_today: Number(r.call_count_today || 0),
    })),
    recent_calls: recentRes.rows,
  });
});

router.get("/employee/:id", async (req, res) => {
  const id = req.params.id;

  if (!req.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (req.user.role !== "owner" && req.user.sub !== id) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const dateFrom = typeof req.query.date_from === "string" ? req.query.date_from : null;
  const dateTo = typeof req.query.date_to === "string" ? req.query.date_to : null;

  const filters: string[] = ["employee_id = $1", "is_misc = FALSE"];
  const values: any[] = [id];

  if (dateFrom) {
    values.push(dateFrom);
    filters.push(`called_at >= $${values.length}`);
  }
  if (dateTo) {
    values.push(dateTo);
    filters.push(`called_at <= $${values.length}`);
  }

  const whereClause = `WHERE ${filters.join(" AND ")}`;

  const totalsRes = await pool.query(
    "SELECT " +
      "COUNT(*) AS total_calls, " +
      "COUNT(*) FILTER (WHERE call_direction='inbound') AS inbound, " +
      "COUNT(*) FILTER (WHERE call_direction='outbound') AS outbound, " +
      "COALESCE(ROUND(AVG(duration_secs)), 0) AS avg_duration_secs, " +
      "ROUND(100.0 * COUNT(*) FILTER (WHERE sentiment = 'positive') / " +
        "NULLIF(COUNT(*) FILTER (WHERE ai_status = 'done'), 0)) AS csat_score " +
    `FROM calls ${whereClause}`,
    values
  );

  const { start: weekStart, end: weekEnd } = getWeekRange();
  const weeklyRes = await pool.query(
    "SELECT date_trunc('day', called_at) AS day, " +
      "COUNT(*) FILTER (WHERE call_direction='inbound') AS inbound, " +
      "COUNT(*) FILTER (WHERE call_direction='outbound') AS outbound, " +
      "COUNT(*) AS total " +
    "FROM calls " +
    "WHERE employee_id = $1 AND is_misc = FALSE AND called_at >= $2 AND called_at < $3 " +
    "GROUP BY day ORDER BY day ASC",
    [id, weekStart.toISOString(), weekEnd.toISOString()]
  );

  const weeklyMap = new Map<string, { inbound: number; outbound: number; total: number }>();
  weeklyRes.rows.forEach((row) => {
    const key = new Date(row.day).toISOString().slice(0, 10);
    weeklyMap.set(key, {
      inbound: Number(row.inbound || 0),
      outbound: Number(row.outbound || 0),
      total: Number(row.total || 0),
    });
  });

  const weekLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const daily_breakdown = weekLabels.map((label, idx) => {
    const day = new Date(weekStart);
    day.setUTCDate(weekStart.getUTCDate() + idx);
    const key = day.toISOString().slice(0, 10);
    const data = weeklyMap.get(key) || { inbound: 0, outbound: 0, total: 0 };
    return {
      date: key,
      day_label: label,
      inbound: data.inbound,
      outbound: data.outbound,
      total: data.total,
    };
  });

  const row = totalsRes.rows[0] || {
    total_calls: 0,
    inbound: 0,
    outbound: 0,
    avg_duration_secs: 0,
    csat_score: 0,
  };

  return res.json({
    total_calls: Number(row.total_calls || 0),
    inbound: Number(row.inbound || 0),
    outbound: Number(row.outbound || 0),
    avg_duration_secs: Number(row.avg_duration_secs || 0),
    csat_score: Number(row.csat_score || 0),
    daily_breakdown,
  });
});

export default router;
