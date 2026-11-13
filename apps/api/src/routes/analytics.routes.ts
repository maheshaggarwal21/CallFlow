import { Router } from "express";
import pool from "../db/pool";
import { requireAuth } from "../middleware/auth";
import {
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

router.get("/employee/:id", async (req, res) => {
  const id = req.params.id;

  if (!req.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (req.user.role === "employee" && req.user.sub !== id) {
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
