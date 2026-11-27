// Line connections (client, 28 Nov 2026; docs/EMPLOYEE-LOGIN-PLAN.md): a rep picks a line, proves it with a test call,
// and holds it until they log out, an admin frees it, or 45 minutes pass with no activity. lines.employee_id is what the FTP receiver
// stamps on each recording; the trigger from migration 034 keeps line_sessions in step with it.
import pool from "../db/pool";
import { IST_TODAY_START } from "../lib/dateRange";
import { findTestCall, TEST_WINDOW_MS, TEST_MIN_SECS, SERVER_IDLE_MS } from "../lib/lineTest";

type Db = { query: typeof pool.query };
export class ConnectError extends Error {
  constructor(public status: number, message: string, public extra: Record<string, unknown> = {}) { super(message); }
}

const WINDOW_SQL = `INTERVAL '${TEST_WINDOW_MS / 1000} seconds'`;
const holderOf = (r: { holder_name: string | null; holder_code: number | null }) =>
  r.holder_name ? `${r.holder_name}${r.holder_code ? ` (${r.holder_code})` : ""}` : "someone";

/** The later of the rep's last touch and the last recording on their line, per connected session. */
const LAST_ACTIVE = `GREATEST(COALESCE(ls.last_seen_at, ls.connected_at),
  COALESCE((SELECT MAX(c.created_at) FROM calls c WHERE c.line_number = ls.line_number AND c.created_at >= ls.connected_at), ls.connected_at))`;

/** Tests past their window fail; connections idle past SERVER_IDLE_MS (page closed) end and free their line. */
export async function tidy(db: Db = pool) {
  await db.query(`UPDATE line_sessions SET status = 'failed', ended_at = started_at + ${WINDOW_SQL}, end_reason = 'no test call arrived'
                   WHERE status = 'testing' AND started_at < NOW() - ${WINDOW_SQL}`);
  const { rows } = await db.query(
    `UPDATE line_sessions s SET status = 'ended', ended_at = NOW(), end_reason = 'idle 45 min'
      FROM line_sessions ls WHERE s.id = ls.id AND ls.status = 'connected'
       AND ${LAST_ACTIVE} < NOW() - INTERVAL '${SERVER_IDLE_MS / 1000} seconds'
      RETURNING s.line_id, s.employee_id`);
  for (const r of rows) {
    await db.query("UPDATE lines SET employee_id = NULL, assigned_at = NULL, freed_at = NOW() WHERE id = $1 AND employee_id = $2", [r.line_id, r.employee_id]);
  }
}

/** The page's activity ping: the rep touched the dashboard. Returns when they were last active (touch or call). */
export async function seen(employeeId: string, touched: boolean) {
  if (touched) await pool.query("UPDATE line_sessions SET last_seen_at = NOW() WHERE employee_id = $1 AND status = 'connected'", [employeeId]);
  const { rows: [r] } = await pool.query(
    `SELECT x.at AS last_active_at, FLOOR(EXTRACT(EPOCH FROM NOW() - x.at))::int AS idle_secs
     FROM line_sessions ls CROSS JOIN LATERAL (SELECT ${LAST_ACTIVE} AS at) x WHERE ls.employee_id = $1 AND ls.status = 'connected'`, [employeeId]);
  // idle_secs is counted on the server, so a PC with a wrong clock still gets it right
  return { connected: !!r, last_active_at: r?.last_active_at ?? null, idle_secs: r?.idle_secs ?? null };
}

let timer: NodeJS.Timeout | null = null;
export function startSessionTidy() {
  if (timer) return;
  timer = setInterval(() => tidy().catch((e) => console.error("line session tidy failed:", (e as Error).message)), 5 * 60_000);
}

/**
 * Offices and their lines with who holds or is testing each. `full` (signed in) gives the holder's name and Reg No;
 * before login only their initial and colour, so the login page can't be used to list who works where.
 */
export async function lineOptions(full: boolean, me?: string) {
  await tidy();
  const { rows } = await pool.query(
    `SELECT t.id AS team_id, t.name AS team_name, t.test_number IS NOT NULL AS has_test_number,
            l.id, l.line_number, l.calling_number, l.employee_id AS holder_id, ts.employee_id AS tester_id,
            e.name AS holder_name, e.employee_code AS holder_code, e.color AS holder_color, e.color_index AS holder_color_index,
            te.name AS tester_name, te.employee_code AS tester_code
     FROM teams t
     LEFT JOIN lines l ON l.team_id = t.id
     LEFT JOIN employees e ON e.id = l.employee_id
     LEFT JOIN line_sessions ts ON ts.line_id = l.id AND ts.status = 'testing'
     LEFT JOIN employees te ON te.id = ts.employee_id
     ORDER BY t.created_at, l.line_number`);
  const offices = new Map<string, { id: string; name: string; has_test_number: boolean; lines: unknown[] }>();
  for (const r of rows) {
    if (!offices.has(r.team_id)) offices.set(r.team_id, { id: r.team_id, name: r.team_name, has_test_number: r.has_test_number, lines: [] });
    if (!r.id) continue;
    const initial = (r.holder_name ?? "").trim().slice(0, 1).toUpperCase();
    // the rep's own line (connected or being tested by them) stays pickable for them
    const mine = !!me && (r.holder_id === me || r.tester_id === me);
    offices.get(r.team_id)!.lines.push({
      id: r.id, line_number: r.line_number, calling_number: r.calling_number, mine,
      holder: r.holder_name && !mine ? { initial, color: r.holder_color, color_index: r.holder_color_index, ...(full ? { name: r.holder_name, reg_no: r.holder_code } : {}) } : null,
      testing: r.tester_name && !mine ? (full ? holderOf({ holder_name: r.tester_name, holder_code: r.tester_code }) : true) : null,
    });
  }
  return [...offices.values()];
}

/** Begin a test on a line, or carry on with the rep's connection if they already hold it today. */
export async function startTest(employeeId: string, lineId: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await tidy(client);
    const { rows: [line] } = await client.query(
      `SELECT l.id, l.line_number, l.calling_number, l.team_id, l.employee_id, t.test_number, t.name AS team_name,
              e.name AS holder_name, e.employee_code AS holder_code
       FROM lines l LEFT JOIN teams t ON t.id = l.team_id LEFT JOIN employees e ON e.id = l.employee_id
       WHERE l.id = $1 FOR UPDATE OF l`, [lineId]);
    if (!line) throw new ConnectError(404, "That calling number no longer exists. Pick another.");
    if (!line.team_id) throw new ConnectError(400, `Line ${line.line_number} isn't in an office yet. Ask an admin to set it on the Intercoms tab.`);
    if (!line.test_number) throw new ConnectError(400, `${line.team_name} has no test number yet. Ask an admin to add one on the Offices tab.`);
    if (line.employee_id && line.employee_id !== employeeId) {
      throw new ConnectError(409, `This line is in use by ${holderOf(line)}.`, { code: "in_use", holder: holderOf(line) });
    }
    const { rows: open } = await client.query(
      "SELECT id, line_id, line_number, status FROM line_sessions WHERE employee_id = $1 AND status IN ('testing', 'connected') FOR UPDATE", [employeeId]);
    const connected = open.find((s) => s.status === "connected");
    if (connected && connected.line_id === lineId) { await client.query("COMMIT"); return; }
    if (connected) throw new ConnectError(409, `You're connected on line ${connected.line_number}. Log out first to change line.`, { code: "connected_elsewhere" });
    const { rows: [other] } = await client.query(
      `SELECT ls.started_at, e.name AS holder_name, e.employee_code AS holder_code FROM line_sessions ls JOIN employees e ON e.id = ls.employee_id
       WHERE ls.line_id = $1 AND ls.status = 'testing' AND ls.employee_id <> $2`, [lineId, employeeId]);
    if (other) {
      const left = Math.max(0, Math.ceil((new Date(other.started_at).getTime() + TEST_WINDOW_MS - Date.now()) / 1000));
      throw new ConnectError(409, `${holderOf(other)} is testing this line right now. Wait ${left} s or pick another number.`, { code: "testing", holder: holderOf(other), seconds_left: left });
    }
    await client.query("UPDATE line_sessions SET status = 'failed', ended_at = NOW(), end_reason = 'test restarted' WHERE employee_id = $1 AND status = 'testing'", [employeeId]);
    await client.query(
      `INSERT INTO line_sessions (line_id, line_number, calling_number, team_id, employee_id, status) VALUES ($1, $2, $3, $4, $5, 'testing')`,
      [line.id, line.line_number, line.calling_number, line.team_id, employeeId]);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    if ((e as { code?: string }).code === "23505") throw new ConnectError(409, "Someone else just took this line. Pick another number.", { code: "in_use" });
    throw e;
  } finally {
    client.release();
  }
}

/** The rep's latest test or connection today; a running test is checked against the recordings that arrived. */
export async function myState(employeeId: string) {
  await tidy();
  const load = () => pool.query(
    `SELECT ls.id, ls.status, ls.line_id, ls.line_number, ls.calling_number, ls.started_at, ls.connected_at, ls.ended_at, ls.end_reason, ls.via,
            t.id AS team_id, t.name AS team_name, t.test_number
     FROM line_sessions ls LEFT JOIN teams t ON t.id = ls.team_id
     WHERE ls.employee_id = $1 AND ls.started_at >= ${IST_TODAY_START} - INTERVAL '1 day'
     ORDER BY (ls.status IN ('testing', 'connected')) DESC, ls.started_at DESC LIMIT 1`, [employeeId]);
  let s = (await load()).rows[0];
  if (!s) return { status: "none" as const };
  let hint: { line_number: string; calling_number: string | null } | null = null;

  if (s.status === "testing" && s.test_number) {
    const started = new Date(s.started_at);
    const { rows: calls } = await pool.query(
      `SELECT id, line_number, caller_phone, duration_secs, created_at FROM calls
       WHERE created_at >= $1 AND call_direction = 'outbound' AND duration_secs >= $2 AND misc_reason IS DISTINCT FROM 'Connection test'`,
      [started, TEST_MIN_SECS]);
    const found = findTestCall(s.line_number, s.test_number, started, calls.map((c) => ({ ...c, created_at: new Date(c.created_at) })));
    if (found.hit) {
      await connect(employeeId, s.id, s.line_id, found.hit.id);
      s = (await load()).rows[0];
    } else if (found.elsewhere) {
      const { rows: [l] } = await pool.query(
        `SELECT l.line_number, l.calling_number FROM lines l
         WHERE l.line_number = $1 AND NOT EXISTS (SELECT 1 FROM line_sessions x WHERE x.line_id = l.id AND x.status = 'testing')`,
        [found.elsewhere.line_number]);
      hint = l ?? { line_number: found.elsewhere.line_number, calling_number: null };
    }
  }

  const failedOrTesting = s.status === "testing" || s.status === "failed";
  const lastUpload = failedOrTesting && s.team_id
    ? (await pool.query("SELECT MAX(c.created_at) AS at FROM calls c JOIN lines l ON l.line_number = c.line_number WHERE l.team_id = $1 AND c.created_at > NOW() - INTERVAL '1 day'", [s.team_id])).rows[0]?.at
    : null;
  return {
    status: s.status as "testing" | "connected" | "failed" | "ended",
    session: {
      id: s.id, line_id: s.line_id, line_number: s.line_number, calling_number: s.calling_number, office: s.team_name,
      test_number: s.test_number, started_at: s.started_at, connected_at: s.connected_at, ended_at: s.ended_at,
      end_reason: s.end_reason, via: s.via,
      seconds_left: s.status === "testing" ? Math.max(0, Math.ceil((new Date(s.started_at).getTime() + TEST_WINDOW_MS - Date.now()) / 1000)) : 0,
    },
    hint,
    office_last_upload_at: lastUpload ?? null,
  };
}

async function connect(employeeId: string, sessionId: string, lineId: string, callId: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: [s] } = await client.query("SELECT status FROM line_sessions WHERE id = $1 FOR UPDATE", [sessionId]);
    if (s?.status !== "testing") { await client.query("ROLLBACK"); return; }
    const { rows: [line] } = await client.query("SELECT employee_id FROM lines WHERE id = $1 FOR UPDATE", [lineId]);
    if (!line || (line.employee_id && line.employee_id !== employeeId)) {
      await client.query("UPDATE line_sessions SET status = 'failed', ended_at = NOW(), end_reason = 'line taken meanwhile' WHERE id = $1", [sessionId]);
      await client.query("COMMIT");
      return;
    }
    await client.query("UPDATE line_sessions SET status = 'connected', connected_at = NOW(), test_call_id = $2 WHERE id = $1", [sessionId, callId]);
    // one line per rep: a line they held by hand elsewhere is freed; then this line is theirs
    await client.query("UPDATE lines SET employee_id = NULL, assigned_at = NULL, freed_at = NOW() WHERE employee_id = $1 AND id <> $2", [employeeId, lineId]);
    await client.query("UPDATE lines SET employee_id = $1, assigned_at = COALESCE(assigned_at, NOW()) WHERE id = $2", [employeeId, lineId]);
    // the test call is the rep's but isn't a lead call
    await client.query("UPDATE calls SET employee_id = $1, is_misc = TRUE, misc_reason = 'Connection test' WHERE id = $2", [employeeId, callId]);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

/** Log out: the rep's test stops and their line is freed. */
export async function endMine(employeeId: string, reason = "logged out") {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `UPDATE line_sessions SET status = CASE WHEN status = 'testing' THEN 'failed' ELSE 'ended' END, ended_at = NOW(), end_reason = $2
       WHERE employee_id = $1 AND status IN ('testing', 'connected') RETURNING line_id, status`, [employeeId, reason]);
    const lines = rows.filter((r) => r.status === "ended").map((r) => r.line_id);
    if (lines.length) {
      await client.query("UPDATE lines SET employee_id = NULL, assigned_at = NULL, freed_at = NOW() WHERE employee_id = $1 AND id = ANY($2::uuid[])", [employeeId, lines]);
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

/** For the top bar and the page guard: the rep's connection now, or null. */
export async function currentConnection(employeeId: string) {
  const { rows: [r] } = await pool.query(
    `SELECT ls.line_number, ls.calling_number, ls.connected_at, t.name AS office FROM line_sessions ls LEFT JOIN teams t ON t.id = ls.team_id
     WHERE ls.employee_id = $1 AND ls.status = 'connected'`, [employeeId]);
  return r ?? null;
}
