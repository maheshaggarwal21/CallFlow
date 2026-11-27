import { Router } from "express";
import { z } from "zod";
import pool from "../db/pool";
import { requireAuth } from "../middleware/auth";
import { requirePermission } from "../middleware/requirePermission";
import { IST_TODAY_START, IST_TZ } from "../lib/dateRange";

const router = Router();

// a connection (client, 28 Nov 2026): the line number the KoreCall box writes in its file names, the calling number on
// it and its office. Line numbers are unique across offices because the file names carry no office.
const lineNo = z.string().trim().regex(/^\d{1,3}$/, "The line is a number like 05").transform((v) => v.padStart(2, "0"));
const callingNo = z.string().transform((v) => v.replace(/\D/g, "")).pipe(z.string().regex(/^\d{6,15}$/, "The calling number should be 6 to 15 digits"));
const createSchema = z.object({ line_number: lineNo, calling_number: callingNo.nullable().optional(), team_id: z.string().uuid().nullable().optional() });
const patchSchema = z.object({
  line_number: lineNo.optional(),
  calling_number: callingNo.nullable().optional(),
  team_id: z.string().uuid().nullable().optional(),
  employee_id: z.string().uuid().nullable().optional(),
  purpose: z.string().max(200).nullable().optional(),
  /** With an agent: also give them the calls that came on this line with no agent since it was freed. */
  claim_gap: z.boolean().optional(),
});
const swapSchema = z.object({ a: z.string().uuid(), b: z.string().uuid(), with_intercoms: z.boolean().optional() });
const bad = (res: any, status: number, message: string) => res.status(status).json({ error: message, message });

router.use(requireAuth);

// Where a line's "no agent" calls start: when it was freed, or for a line that never had anyone (Office 2's new lines,
// 21 Nov 2026) the start of this IST month, so months-old calls from the old PBX's numbering are never handed out
const GAP_FROM = (l: string) =>
  `COALESCE(${l}.freed_at, date_trunc('month', now() AT TIME ZONE '${IST_TZ}') AT TIME ZONE '${IST_TZ}')`;

router.get("/", async (_req, res) => {
  const result = await pool.query(
    "SELECT l.id, l.line_number, l.employee_id, l.purpose, l.assigned_at, l.freed_at, " +
      "l.team_id, t.name AS team_name, l.calling_number, s.connected_at, s.via AS connected_via, " +
      "e.name AS employee_name, e.color_index AS employee_color_index, e.color AS employee_color, e.employee_code, " +
      "COALESCE(c.cnt, 0) AS call_count_today, COALESCE(g.n, 0) AS gap_calls " +
    "FROM lines l " +
    "LEFT JOIN employees e ON e.id = l.employee_id " +
    "LEFT JOIN teams t ON t.id = l.team_id " +
    "LEFT JOIN line_sessions s ON s.line_id = l.id AND s.status = 'connected' " +
    // calls that came in on this line with no agent since it was freed (or this month, for a line that never had anyone):
    // they count for nobody until given to someone
    "LEFT JOIN LATERAL (SELECT COUNT(*) AS n FROM calls g WHERE g.line_number = l.line_number " +
      `AND g.employee_id IS NULL AND g.called_at >= ${GAP_FROM("l")}) g ON TRUE ` +
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
  if (!parsed.success) return bad(res, 400, parsed.error.issues[0].message);
  if (!z.string().uuid().safeParse(req.params.id).success) return bad(res, 404, "Not found");
  const u = parsed.data;
  if ([u.employee_id, u.purpose, u.line_number, u.calling_number, u.team_id].every((v) => v === undefined)) return bad(res, 400, "No fields to update");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: [line] } = await client.query("SELECT id, line_number, employee_id, freed_at FROM lines WHERE id = $1 FOR UPDATE", [req.params.id]);
    if (!line) { await client.query("ROLLBACK"); return bad(res, 404, "Not found"); }
    if (u.line_number !== undefined && u.line_number !== line.line_number && line.employee_id && u.employee_id !== null) {
      await client.query("ROLLBACK");
      return bad(res, 409, `Someone is connected on line ${line.line_number}. Free the line before changing its number.`);
    }

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
    if (u.line_number !== undefined) { values.push(u.line_number); fields.push(`line_number = $${values.length}`); }
    if (u.calling_number !== undefined) { values.push(u.calling_number ?? null); fields.push(`calling_number = $${values.length}`); }
    if (u.team_id !== undefined) { values.push(u.team_id ?? null); fields.push(`team_id = $${values.length}::uuid`); }
    values.push(line.id);
    const { rows: [row] } = await client.query(
      `UPDATE lines SET ${fields.join(", ")} WHERE id = $${values.length} RETURNING id, line_number, employee_id, purpose, assigned_at, freed_at, calling_number, team_id`, values);

    let claimed = 0;
    if (u.claim_gap && u.employee_id) {
      claimed = (await client.query(
        `UPDATE calls c SET employee_id = $1 FROM lines l WHERE l.id = $3 AND c.line_number = $2 AND c.employee_id IS NULL AND c.called_at >= ${GAP_FROM("l")}`,
        [u.employee_id, row.line_number, row.id])).rowCount ?? 0;
    }
    await client.query("COMMIT");
    return res.json({ ...row, claimed });
  } catch (e) {
    await client.query("ROLLBACK");
    const msg = dupLine(e, u.line_number);
    if (msg) return bad(res, 409, msg);
    throw e;
  } finally {
    client.release();
  }
});

const dupLine = (e: unknown, n?: string) => ((e as { code?: string })?.code === "23505" ? `Line ${n} already exists` : (e as { code?: string })?.code === "23503" ? "That office no longer exists" : null);

router.post("/", requirePermission("intercoms"), async (req, res) => {
  const p = createSchema.safeParse(req.body);
  if (!p.success) return bad(res, 400, p.error.issues[0].message);
  try {
    const { rows: [row] } = await pool.query(
      "INSERT INTO lines (line_number, calling_number, team_id) VALUES ($1, $2, $3) RETURNING id, line_number, calling_number, team_id",
      [p.data.line_number, p.data.calling_number ?? null, p.data.team_id ?? null]);
    return res.status(201).json(row);
  } catch (e) {
    const msg = dupLine(e, p.data.line_number);
    if (msg) return bad(res, 409, msg);
    throw e;
  }
});

/** Remove a connection. Its past calls keep their line and calling number (both are stored on each call). */
router.delete("/:id", requirePermission("intercoms"), async (req, res) => {
  if (!z.string().uuid().safeParse(req.params.id).success) return bad(res, 404, "Not found");
  const { rows: [l] } = await pool.query("SELECT line_number, employee_id FROM lines WHERE id = $1", [req.params.id]);
  if (!l) return bad(res, 404, "Not found");
  if (l.employee_id) return bad(res, 409, `Someone is connected on line ${l.line_number}. Free the line first.`);
  await pool.query("DELETE FROM lines WHERE id = $1 AND employee_id IS NULL", [req.params.id]);
  return res.status(204).end();
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
