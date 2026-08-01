import { Router } from "express";
import pool from "../db/pool";
import { requireAuth } from "../middleware/auth";
import { requireOwner } from "../middleware/requireOwner";
import {
  IST_TODAY_START,
  bucketKeyExpr,
  enumerateBuckets,
  pickBucket,
  resolveRange,
} from "../lib/dateRange";

const router = Router();

router.use(requireAuth);

type ActivityPoint = {
  date: string;
  day_label: string;
  inbound: number;
  outbound: number;
  total: number;
};

/**
 * Call volume bucketed across `[start, end)`, aligned to IST day boundaries.
 *
 * The granularity follows the selected range (hourly for a single day, daily up
 * to two months, monthly beyond) so the chart always sums to the stat cards
 * above it — the old version hard-coded "current Mon–Sun week" regardless of
 * the filter, which is why a "Today" selection showed a full week of bars.
 */
async function buildActivitySeries(
  start: Date,
  end: Date,
  employeeId?: string | null
): Promise<ActivityPoint[]> {
  const values: any[] = [start.toISOString(), end.toISOString()];
  let scope = "";
  if (employeeId) {
    values.push(employeeId);
    scope = ` AND employee_id = $${values.length}`;
  }
  const where = `WHERE is_misc = FALSE AND called_at >= $1 AND called_at < $2${scope}`;

  let spanStart = start;
  let spanEnd = end;

  // "All Time" spans decades of empty calendar; clamp wide ranges to the window
  // that actually holds calls before enumerating buckets.
  if (pickBucket(start, end) === "month") {
    const bounds = await pool.query(
      `SELECT MIN(called_at) AS min_at, MAX(called_at) AS max_at FROM calls ${where}`,
      values
    );
    const minAt = bounds.rows[0]?.min_at ? new Date(bounds.rows[0].min_at) : null;
    const maxAt = bounds.rows[0]?.max_at ? new Date(bounds.rows[0].max_at) : null;
    if (!minAt || !maxAt) return [];
    spanStart = new Date(Math.max(start.getTime(), minAt.getTime()));
    spanEnd = new Date(Math.min(end.getTime(), maxAt.getTime() + 1));
  }

  const bucket = pickBucket(spanStart, spanEnd);
  const keyExpr = bucketKeyExpr(bucket);

  const rowsRes = await pool.query(
    `SELECT ${keyExpr} AS bucket_key, ` +
      "COUNT(*) FILTER (WHERE call_direction='inbound') AS inbound, " +
      "COUNT(*) FILTER (WHERE call_direction='outbound') AS outbound, " +
      "COUNT(*) AS total " +
    `FROM calls ${where} ` +
    `GROUP BY ${keyExpr} ORDER BY 1 ASC`,
    values
  );

  const byKey = new Map<string, { inbound: number; outbound: number; total: number }>();
  rowsRes.rows.forEach((r) => {
    byKey.set(String(r.bucket_key), {
      inbound: Number(r.inbound || 0),
      outbound: Number(r.outbound || 0),
      total: Number(r.total || 0),
    });
  });

  return enumerateBuckets(spanStart, spanEnd, bucket).map(({ key, label }) => {
    const d = byKey.get(key) || { inbound: 0, outbound: 0, total: 0 };
    return { date: key, day_label: label, inbound: d.inbound, outbound: d.outbound, total: d.total };
  });
}

function pctDelta(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 100);
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

  const row = result.rows[0];
  return res.json({
    count: Number(row.count || 0),
    avg_duration_secs: Number(row.avg_duration_secs || 0),
    disconnected_count: Number(row.disconnected_count || 0),
    no_response_count: Number(row.no_response_count || 0),
  });
});

router.get("/overview", requireOwner, async (req, res) => {
  const dateFromParam = typeof req.query.date_from === "string" ? req.query.date_from : null;
  const dateToParam   = typeof req.query.date_to   === "string" ? req.query.date_to   : null;

  const { start, end } = resolveRange(dateFromParam, dateToParam);

  // Compare against the equal-length window immediately before the selection so
  // the delta stays meaningful for every preset, not just whole months.
  const spanMs = Math.max(end.getTime() - start.getTime(), 1);
  const prevEnd = start;
  const prevStart = new Date(start.getTime() - spanMs);

  const TOTALS_SQL =
    "SELECT " +
      "COUNT(*) AS total, " +
      "COUNT(*) FILTER (WHERE call_direction='inbound') AS inbound, " +
      "COUNT(*) FILTER (WHERE call_direction='outbound') AS outbound, " +
      "COALESCE(ROUND(AVG(duration_secs)), 0) AS avg_duration_secs " +
    "FROM calls WHERE is_misc = FALSE AND called_at >= $1 AND called_at < $2";

  const [totalsRes, prevRes] = await Promise.all([
    pool.query(TOTALS_SQL, [start.toISOString(), end.toISOString()]),
    pool.query(TOTALS_SQL, [prevStart.toISOString(), prevEnd.toISOString()]),
  ]);

  const totals = totalsRes.rows[0];
  const prev = prevRes.rows[0];

  const totalCalls  = Number(totals.total || 0);
  const inbound     = Number(totals.inbound || 0);
  const outbound    = Number(totals.outbound || 0);
  const avgDuration = Number(totals.avg_duration_secs || 0);

  const prevTotal    = Number(prev.total || 0);
  const prevInbound  = Number(prev.inbound || 0);
  const prevOutbound = Number(prev.outbound || 0);
  const prevAvg      = Number(prev.avg_duration_secs || 0);

  const momDelta = {
    total_pct: pctDelta(totalCalls, prevTotal),
    inbound_pct: pctDelta(inbound, prevInbound),
    outbound_pct: pctDelta(outbound, prevOutbound),
    avg_duration_secs: Math.round(avgDuration - prevAvg),
  };

  const directionSplit = {
    inbound_pct: totalCalls > 0 ? Math.round((inbound / totalCalls) * 100) : 0,
    outbound_pct: totalCalls > 0 ? Math.round((outbound / totalCalls) * 100) : 0,
  };

  // Percentages are taken against every non-misc call in range (not just the
  // attributed ones) so the agent bars and the donut centre agree.
  const teamRes = await pool.query(
    "SELECT c.employee_id, e.name, e.color_index, COUNT(*) AS count " +
    "FROM calls c " +
    "JOIN employees e ON e.id = c.employee_id " +
    "WHERE c.is_misc = FALSE AND c.called_at >= $1 AND c.called_at < $2 " +
    "GROUP BY c.employee_id, e.name, e.color_index " +
    "ORDER BY count DESC",
    [start.toISOString(), end.toISOString()]
  );

  const teamSplit = teamRes.rows.map((r) => {
    const count = Number(r.count || 0);
    return {
      employee_id: r.employee_id,
      name: r.name,
      count,
      pct: totalCalls > 0 ? Math.round((count / totalCalls) * 100) : 0,
      color_index: Number(r.color_index || 0),
    };
  });

  const attributed = teamSplit.reduce((sum, t) => sum + t.count, 0);
  const unassignedCount = Math.max(totalCalls - attributed, 0);

  const weeklyActivity = await buildActivitySeries(start, end);

  const resRes = await pool.query(
    "SELECT " +
      "COUNT(*) FILTER (WHERE resolution_status = 'resolved') AS resolved_count, " +
      "COUNT(*) FILTER (WHERE resolution_status = 'escalated') AS escalated_count, " +
      "COUNT(*) FILTER (WHERE resolution_status = 'no_response') AS no_response_count " +
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
        `AND called_at >= ${IST_TODAY_START} ` +
        `AND called_at < ${IST_TODAY_START} + INTERVAL '1 day' ` +
      "GROUP BY line_number " +
    ") c ON c.line_number = l.line_number " +
    "ORDER BY l.line_number ASC"
  );

  const recentRes = await pool.query(
    "SELECT c.id, c.source, c.device_id, c.line_number, c.intercom_code, " +
      "c.call_direction, c.caller_phone, c.student_name, c.called_at, c.duration_secs, " +
      "c.employee_id, c.is_misc, c.misc_reason, c.resolution_status, c.created_at, c.updated_at, " +
      "i.phone_number AS intercom_phone_number, " +
      "'KoreCall' AS source_label, " +
      "e.color_index AS color_index, e.name AS employee_name " +
    "FROM calls c " +
    "LEFT JOIN intercoms i ON i.intercom_code = c.intercom_code " +
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
    team_split: teamSplit,
    unassigned_count: unassignedCount,
    unassigned_pct: totalCalls > 0 ? Math.round((unassignedCount / totalCalls) * 100) : 0,
    weekly_activity: weeklyActivity,
    resolved_count: Number(resRes.rows[0]?.resolved_count || 0),
    escalated_count: Number(resRes.rows[0]?.escalated_count || 0),
    no_response_count: Number(resRes.rows[0]?.no_response_count || 0),
    top_line: topLineRes.rows[0]
      ? { line_number: topLineRes.rows[0].line_number, call_count: Number(topLineRes.rows[0].call_count) }
      : null,
    line_status: lineStatusRes.rows.map((r) => ({
      line: r.line,
      employee_name: r.employee_name,
      call_count_today: Number(r.call_count_today || 0),
    })),
    recent_calls: recentRes.rows,
    range: { from: start.toISOString(), to: end.toISOString() },
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
  const dateTo   = typeof req.query.date_to   === "string" ? req.query.date_to   : null;

  // Same range resolution as /overview — an unfiltered request means all time
  // here, so only clamp when the caller actually sent a range.
  const hasRange = Boolean(dateFrom || dateTo);
  const { start, end } = hasRange
    ? resolveRange(dateFrom, dateTo)
    : { start: new Date(0), end: new Date(Date.now() + 24 * 60 * 60 * 1000) };

  const values = [id, start.toISOString(), end.toISOString()];
  const whereClause =
    "WHERE employee_id = $1 AND is_misc = FALSE AND called_at >= $2 AND called_at < $3";

  const totalsRes = await pool.query(
    "SELECT " +
      "COUNT(*) AS total_calls, " +
      "COUNT(*) FILTER (WHERE call_direction='inbound') AS inbound, " +
      "COUNT(*) FILTER (WHERE call_direction='outbound') AS outbound, " +
      "COALESCE(ROUND(AVG(duration_secs)), 0) AS avg_duration_secs " +
    `FROM calls ${whereClause}`,
    values
  );

  const daily_breakdown = await buildActivitySeries(start, end, id);

  const row = totalsRes.rows[0] || {};

  return res.json({
    total_calls: Number(row.total_calls || 0),
    inbound: Number(row.inbound || 0),
    outbound: Number(row.outbound || 0),
    avg_duration_secs: Number(row.avg_duration_secs || 0),
    daily_breakdown,
    range: { from: start.toISOString(), to: end.toISOString() },
  });
});

export default router;
