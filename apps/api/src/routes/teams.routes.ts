import { Router } from "express";
import { z } from "zod";
import pool from "../db/pool";
import { requireAuth } from "../middleware/auth";
import { requirePermission } from "../middleware/requirePermission";
import { istDateKey, resolveRange } from "../lib/dateRange";

// Offices tab (was Teams; client, 13 Nov 2026, renamed 28 Nov): offices in two or more places, each with its own agents.
const router = Router();
router.use(requireAuth);
// the Users form lists and creates teams too (client, 15 Nov 2026); changing or deleting one stays on the Teams tab
const teamsOrUsers = requirePermission("teams", "users");
const teamsTab = requirePermission("teams");

const bad = (res: any, status: number, message: string) => res.status(status).json({ error: message, message });
const teamSchema = z.object({
  name: z.string().trim().min(1, "Give the office a name").max(60),
  location: z.string().trim().max(60).nullable().optional(),
  // the number reps dial to test their line (client, 28 Nov 2026); kept as digits
  test_number: z.string().transform((v) => v.replace(/\D/g, "").replace(/^91(\d{10})$/, "$1")).pipe(z.string().regex(/^(\d{6,15})?$/, "The test number should be 6 to 15 digits"))
    .nullable().optional(),
});
const uuid = z.string().uuid();

/**
 * Every team with its agents and their calls in the period asked for (`date_from` / `date_to`, IST days; today when
 * neither is given, client 15 Nov 2026), plus the agents in no team. The Super Admin is not an agent.
 * The fields keep their old names (`calls_today`, `talk_secs_today`) but hold the period's totals; every call
 * counts, short ones too, the same as the Talk time card on My Dashboard.
 */
router.get("/", teamsOrUsers, async (req, res) => {
  const today = istDateKey(new Date());
  const q = (k: string) => (typeof req.query[k] === "string" && req.query[k] ? (req.query[k] as string) : null);
  const both = !q("date_from") && !q("date_to");
  const { start, end } = resolveRange(both ? today : q("date_from"), both ? today : q("date_to"));
  const [teams, agents] = await Promise.all([
    pool.query("SELECT id, name, location, color_index, test_number FROM teams ORDER BY created_at"),
    pool.query(
      `SELECT e.id, e.name, e.designation, e.color_index, e.team_id, e.employee_code,
              COALESCE(c.calls, 0)::int AS calls_today, COALESCE(c.secs, 0)::int AS talk_secs_today
       FROM employees e
       LEFT JOIN (SELECT employee_id, COUNT(*) AS calls, SUM(duration_secs) AS secs FROM calls
                  WHERE called_at >= $1 AND called_at < $2
                  GROUP BY employee_id) c ON c.employee_id = e.id
       WHERE e.status = 'active' AND e.role <> 'owner'
       ORDER BY e.name`, [start, end]),
  ]);
  return res.json({
    teams: teams.rows.map((t) => ({ ...t, members: agents.rows.filter((a) => a.team_id === t.id) })),
    unassigned: agents.rows.filter((a) => !a.team_id),
  });
});

const conflict = (err: any) => (err?.code === "23505" ? "An office with that name already exists" : null);

router.post("/", teamsOrUsers, async (req, res) => {
  const p = teamSchema.safeParse(req.body);
  if (!p.success) return bad(res, 400, p.error.issues[0].message);
  try {
    const { rows: [t] } = await pool.query(
      // next colour in the palette, so each office has its own
      `INSERT INTO teams (name, location, test_number, color_index) VALUES ($1, $2, $3, (SELECT COALESCE(MAX(color_index), -1) + 1 FROM teams))
       RETURNING id, name, location, color_index, test_number`,
      [p.data.name, p.data.location || null, p.data.test_number || null]);
    return res.status(201).json(t);
  } catch (err) {
    const msg = conflict(err);
    if (msg) return bad(res, 409, msg);
    throw err;
  }
});

router.patch("/:id", teamsTab, async (req, res) => {
  const p = teamSchema.safeParse(req.body);
  if (!p.success) return bad(res, 400, p.error.issues[0].message);
  if (!uuid.safeParse(req.params.id).success) return bad(res, 404, "Office not found");
  try {
    const { rows: [t] } = await pool.query(
      `UPDATE teams SET name = $1, location = $2, test_number = CASE WHEN $4::boolean THEN $5 ELSE test_number END
       WHERE id = $3 RETURNING id, name, location, color_index, test_number`,
      [p.data.name, p.data.location || null, req.params.id, p.data.test_number !== undefined, p.data.test_number || null]);
    return t ? res.json(t) : bad(res, 404, "Office not found");
  } catch (err) {
    const msg = conflict(err);
    if (msg) return bad(res, 409, msg);
    throw err;
  }
});

/** Its agents are kept, just without a team. */
router.delete("/:id", teamsTab, async (req, res) => {
  if (!uuid.safeParse(req.params.id).success) return bad(res, 404, "Office not found");
  const r = await pool.query("DELETE FROM teams WHERE id = $1", [req.params.id]);
  return r.rowCount ? res.status(204).end() : bad(res, 404, "Office not found");
});

/** Move one agent into a team, or out of all teams with team_id null. */
router.put("/members/:employeeId", async (req, res) => {
  const p = z.object({ team_id: uuid.nullable() }).safeParse(req.body);
  if (!p.success || !uuid.safeParse(req.params.employeeId).success) return bad(res, 400, "Pick an office");
  try {
    const r = await pool.query("UPDATE employees SET team_id = $1 WHERE id = $2 AND role <> 'owner' RETURNING id", [p.data.team_id, req.params.employeeId]);
    return r.rowCount ? res.json({ id: req.params.employeeId, team_id: p.data.team_id }) : bad(res, 404, "Agent not found");
  } catch (err: any) {
    if (err?.code === "23503") return bad(res, 404, "Office not found");
    throw err;
  }
});

export default router;
