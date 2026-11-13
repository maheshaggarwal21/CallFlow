import { Router } from "express";
import { z } from "zod";
import pool from "../db/pool";
import { requireAuth } from "../middleware/auth";
import { requirePermission } from "../middleware/requirePermission";
import { IST_TODAY_START } from "../lib/dateRange";

// Teams tab (client, 13 Nov 2026): offices in two or more places, each with its own agents.
const router = Router();
router.use(requireAuth, requirePermission("teams"));

const bad = (res: any, status: number, message: string) => res.status(status).json({ error: message, message });
const teamSchema = z.object({
  name: z.string().trim().min(1, "Give the team a name").max(60),
  location: z.string().trim().max(60).nullable().optional(),
});
const uuid = z.string().uuid();

/** Every team with its agents and their calls today, plus the agents in no team. The Super Admin is not an agent. */
router.get("/", async (_req, res) => {
  const [teams, agents] = await Promise.all([
    pool.query("SELECT id, name, location, color_index FROM teams ORDER BY created_at"),
    pool.query(
      `SELECT e.id, e.name, e.designation, e.color_index, e.team_id, e.employee_code,
              COALESCE(c.calls, 0)::int AS calls_today, COALESCE(c.secs, 0)::int AS talk_secs_today
       FROM employees e
       LEFT JOIN (SELECT employee_id, COUNT(*) AS calls, SUM(duration_secs) AS secs FROM calls
                  WHERE is_misc = FALSE AND called_at >= ${IST_TODAY_START} AND called_at < ${IST_TODAY_START} + INTERVAL '1 day'
                  GROUP BY employee_id) c ON c.employee_id = e.id
       WHERE e.status = 'active' AND e.role <> 'owner'
       ORDER BY e.name`),
  ]);
  return res.json({
    teams: teams.rows.map((t) => ({ ...t, members: agents.rows.filter((a) => a.team_id === t.id) })),
    unassigned: agents.rows.filter((a) => !a.team_id),
  });
});

const conflict = (err: any) => (err?.code === "23505" ? "A team with that name already exists" : null);

router.post("/", async (req, res) => {
  const p = teamSchema.safeParse(req.body);
  if (!p.success) return bad(res, 400, p.error.issues[0].message);
  try {
    const { rows: [t] } = await pool.query(
      // next colour in the palette, so each office has its own
      `INSERT INTO teams (name, location, color_index) VALUES ($1, $2, (SELECT COALESCE(MAX(color_index), -1) + 1 FROM teams)) RETURNING id, name, location, color_index`,
      [p.data.name, p.data.location || null]);
    return res.status(201).json(t);
  } catch (err) {
    const msg = conflict(err);
    if (msg) return bad(res, 409, msg);
    throw err;
  }
});

router.patch("/:id", async (req, res) => {
  const p = teamSchema.safeParse(req.body);
  if (!p.success) return bad(res, 400, p.error.issues[0].message);
  if (!uuid.safeParse(req.params.id).success) return bad(res, 404, "Team not found");
  try {
    const { rows: [t] } = await pool.query(
      "UPDATE teams SET name = $1, location = $2 WHERE id = $3 RETURNING id, name, location, color_index",
      [p.data.name, p.data.location || null, req.params.id]);
    return t ? res.json(t) : bad(res, 404, "Team not found");
  } catch (err) {
    const msg = conflict(err);
    if (msg) return bad(res, 409, msg);
    throw err;
  }
});

/** Its agents are kept, just without a team. */
router.delete("/:id", async (req, res) => {
  if (!uuid.safeParse(req.params.id).success) return bad(res, 404, "Team not found");
  const r = await pool.query("DELETE FROM teams WHERE id = $1", [req.params.id]);
  return r.rowCount ? res.status(204).end() : bad(res, 404, "Team not found");
});

/** Move one agent into a team, or out of all teams with team_id null. */
router.put("/members/:employeeId", async (req, res) => {
  const p = z.object({ team_id: uuid.nullable() }).safeParse(req.body);
  if (!p.success || !uuid.safeParse(req.params.employeeId).success) return bad(res, 400, "Pick a team");
  try {
    const r = await pool.query("UPDATE employees SET team_id = $1 WHERE id = $2 AND role <> 'owner' RETURNING id", [p.data.team_id, req.params.employeeId]);
    return r.rowCount ? res.json({ id: req.params.employeeId, team_id: p.data.team_id }) : bad(res, 404, "Agent not found");
  } catch (err: any) {
    if (err?.code === "23503") return bad(res, 404, "Team not found");
    throw err;
  }
});

export default router;
