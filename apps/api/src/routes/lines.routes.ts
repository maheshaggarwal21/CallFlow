import { Router } from "express";
import { z } from "zod";
import pool from "../db/pool";
import { requireAuth } from "../middleware/auth";
import { requirePermission } from "../middleware/requirePermission";
import { IST_TODAY_START } from "../lib/dateRange";

const router = Router();

const patchSchema = z.object({
  employee_id: z.string().uuid().nullable().optional(),
  purpose: z.string().max(200).nullable().optional(),
  /** With an agent: also give them the calls that came on this line with no agent since it was freed. */
  claim_gap: z.boolean().optional(),
});
const swapSchema = z.object({ a: z.string().uuid(), b: z.string().uuid(), with_intercoms: z.boolean().optional() });
const bad = (res: any, status: number, message: string) => res.status(status).json({ error: message, message });

router.use(requireAuth);

router.get("/", async (_req, res) => {
  const result = await pool.query(
    "SELECT l.id, l.line_number, l.employee_id, l.purpose, l.assigned_at, l.freed_at, " +
      "e.name AS employee_name, e.color_index AS employee_color_index, e.employee_code, " +
      "COALESCE(c.cnt, 0) AS call_count_today, COALESCE(g.n, 0) AS gap_calls " +
    "FROM lines l " +
    "LEFT JOIN employees e ON e.id = l.employee_id " +
    // calls that came in on this line with no agent since it was freed: they count for nobody until given to someone
    "LEFT JOIN LATERAL (SELECT COUNT(*) AS n FROM calls g WHERE l.freed_at IS NOT NULL AND g.line_number = l.line_number " +
      "AND g.employee_id IS NULL AND g.called_at >= l.freed_at) g ON TRUE " +
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

  return res.json(result.rows.map((r) => ({
    ...r,
    call_count_today: Number(r.call_count_today),
    gap_calls: Number(r.gap_calls),
    employee_color_index: r.employee_color_index !== null ? Number(r.employee_color_index) : null,
  })));
});

// a line's person is set on the Intercoms tab (the Lines tab was folded in there, 14 Nov 2026)
router.patch("/:id", requirePermission("intercoms"), async (req, res) => {
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) return bad(res, 400, "Invalid request");
  if (!z.string().uuid().safeParse(req.params.id).success) return bad(res, 404, "Not found");
  const u = parsed.data;
  if (u.employee_id === undefined && u.purpose === undefined) return bad(res, 400, "No fields to update");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: [line] } = await client.query("SELECT id, line_number, employee_id, freed_at FROM lines WHERE id = $1 FOR UPDATE", [req.params.id]);
    if (!line) { await client.query("ROLLBACK"); return bad(res, 404, "Not found"); }

    if (u.employee_id) {
      // one person per line and one line per person (client, 15 Nov 2026); only someone who works here can hold one
      const { rows: [p] } = await client.query(
        `SELECT e.name, e.status, (SELECT l2.line_number FROM lines l2 WHERE l2.employee_id = e.id AND l2.id <> $2 LIMIT 1) AS other_line
         FROM employees e WHERE e.id = $1`, [u.employee_id, line.id]);
      if (!p) { await client.query("ROLLBACK"); return bad(res, 400, "That person doesn't exist"); }
      if (p.status !== "active") { await client.query("ROLLBACK"); return bad(res, 400, `${p.name} is switched off`); }
      if (p.other_line) { await client.query("ROLLBACK"); return bad(res, 409, `${p.name} already has line ${p.other_line}. Use Swap agents, or free that line first.`); }
    }

    const fields: string[] = [];
    const values: Array<string | null> = [];
    if (u.employee_id !== undefined) {
      values.push(u.employee_id);
      const i = values.length;
      fields.push(`employee_id = $${i}::uuid`);
      fields.push(`assigned_at = CASE WHEN $${i}::uuid IS NULL THEN NULL WHEN employee_id IS NOT DISTINCT FROM $${i}::uuid THEN assigned_at ELSE NOW() END`);
      // the moment the line loses its agent starts the window in which its calls have no agent
      fields.push(`freed_at = CASE WHEN $${i}::uuid IS NULL AND employee_id IS NOT NULL THEN NOW() ELSE freed_at END`);
    }
    if (u.purpose !== undefined) { values.push(u.purpose ?? null); fields.push(`purpose = $${values.length}`); }
    values.push(line.id);
    const { rows: [row] } = await client.query(
      `UPDATE lines SET ${fields.join(", ")} WHERE id = $${values.length} RETURNING id, line_number, employee_id, purpose, assigned_at, freed_at`, values);

    let claimed = 0;
    if (u.claim_gap && u.employee_id && row.freed_at) {
      claimed = (await client.query(
        "UPDATE calls SET employee_id = $1 WHERE line_number = $2 AND employee_id IS NULL AND called_at >= $3",
        [u.employee_id, row.line_number, row.freed_at])).rowCount ?? 0;
    }
    await client.query("COMMIT");
    return res.json({ ...row, claimed });
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
});

/**
 * Swap the agents of two lines in one step (client, 15 Nov 2026): with one person per line you can't do it by picking
 * from the lists. Past calls stay with whoever had the line then. Optionally the two intercoms trade lines as well.
 */
router.post("/swap", requirePermission("intercoms"), async (req, res) => {
  const parsed = swapSchema.safeParse(req.body);
  if (!parsed.success) return bad(res, 400, "Pick two lines");
  const { a, b, with_intercoms } = parsed.data;
  if (a === b) return bad(res, 400, "Pick two different lines");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query("SELECT id, line_number, employee_id FROM lines WHERE id = ANY($1::uuid[]) FOR UPDATE", [[a, b]]);
    const la = rows.find((r) => r.id === a), lb = rows.find((r) => r.id === b);
    if (!la || !lb) { await client.query("ROLLBACK"); return bad(res, 404, "Line not found"); }
    if (!la.employee_id || !lb.employee_id) {
      await client.query("ROLLBACK");
      return bad(res, 400, "Both lines need an agent to swap. To move one agent to a free line, edit an intercom and pick the line and the agent.");
    }
    await client.query(
      `UPDATE lines SET employee_id = CASE WHEN id = $1::uuid THEN $3::uuid ELSE $2::uuid END, assigned_at = NOW() WHERE id IN ($1::uuid, $4::uuid)`,
      [a, la.employee_id, lb.employee_id, b]);
    if (with_intercoms) {
      // an intercom's line is unique, so both leave their line first
      const { rows: ics } = await client.query("SELECT id, line_number FROM intercoms WHERE line_number IN ($1, $2)", [la.line_number, lb.line_number]);
      await client.query("UPDATE intercoms SET line_number = NULL WHERE id = ANY($1::uuid[])", [ics.map((i) => i.id)]);
      for (const i of ics) {
        await client.query("UPDATE intercoms SET line_number = $1 WHERE id = $2", [i.line_number === la.line_number ? lb.line_number : la.line_number, i.id]);
      }
    }
    await client.query("COMMIT");
    return res.json({ swapped: [la.line_number, lb.line_number] });
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
});

export default router;
