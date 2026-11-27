import { Router, type Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import pool from "../db/pool";
import { requireAuth } from "../middleware/auth";
import { lineOptions, startTest, ConnectError, currentConnection, endMine } from "../services/lineSession.service";
import { maskPhone } from "../lib/lineTest";

const router = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(72),
});

router.post("/login", loginLimiter, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request" });
  }

  const { email, password } = parsed.data;

  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    return res.status(500).json({ error: "Server misconfigured" });
  }

  const result = await pool.query(
    "SELECT id, name, email, role, color_index, password_hash FROM employees WHERE email = $1 AND status = 'active' LIMIT 1",
    [email]
  );

  if (result.rows.length === 0) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const user = result.rows[0];
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  return res.json({ user: issueToken(res, user, jwtSecret) });
});

/** Signs the person in: the 8 h cookie, and the user the browser keeps. */
function issueToken(res: Response, user: { id: string; name: string; email: string; role: string; color_index: number }, jwtSecret: string) {
  const token = jwt.sign({ sub: user.id, role: user.role, name: user.name, color_index: user.color_index }, jwtSecret, { expiresIn: "8h" });
  const isProd = process.env.NODE_ENV === "production";
  res.cookie("token", token, {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "none" : "lax",
    maxAge: 8 * 60 * 60 * 1000,
    path: "/",
    ...(process.env.COOKIE_DOMAIN ? { domain: process.env.COOKIE_DOMAIN } : {}),
  });
  return { id: user.id, name: user.name, email: user.email, role: user.role, color_index: user.color_index };
}

// ── Employee login (client, 28 Nov 2026; docs/EMPLOYEE-LOGIN-PLAN.md): Reg No → name and masked phone → office and
// calling number → password. Reg Nos are short and sequential, so the steps before the password are rate-limited and
// show only what the client asked for: the name and the phone as 98******66.
const regNo = z.coerce.number().int().min(1).max(99_999_999);
// all reps of an office share one internet address, so: lookups are generous, and logins count only failed tries
const tooMany = { error: "Too many tries from this office. Wait 15 minutes and try again.", message: "Too many tries from this office. Wait 15 minutes and try again." };
const lookupLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: process.env.NODE_ENV === "production" ? 150 : 1000, standardHeaders: true, legacyHeaders: false, message: tooMany });
const employeeLoginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, skipSuccessfulRequests: true, standardHeaders: true, legacyHeaders: false, message: tooMany });
const notFound = "No one with that Reg No. Check the number or ask an admin.";
const findByReg = (reg: number) => pool.query(
  "SELECT id, name, email, phone, role, color_index, password_hash, team_id FROM employees WHERE employee_code = $1 AND status = 'active' LIMIT 1", [reg]);

router.post("/employee/lookup", lookupLimiter, async (req, res) => {
  const p = z.object({ reg_no: regNo }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "Type your Reg No (numbers only)", message: "Type your Reg No (numbers only)" });
  const { rows: [e] } = await findByReg(p.data.reg_no);
  if (!e) return res.status(404).json({ error: notFound, message: notFound });
  const offices = await lineOptions(false, e.id);
  return res.json({ name: e.name, phone_masked: maskPhone(e.phone), home_office_id: e.team_id, offices });
});

router.post("/employee/login", employeeLoginLimiter, async (req, res) => {
  const p = z.object({ reg_no: regNo, password: z.string().min(1).max(72), line_id: z.string().uuid() }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "Fill in every step", message: "Fill in every step" });
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) return res.status(500).json({ error: "Server misconfigured" });
  const { rows: [e] } = await findByReg(p.data.reg_no);
  if (!e || !(await bcrypt.compare(p.data.password, e.password_hash))) {
    return res.status(401).json({ error: "Wrong Reg No or password", message: "Wrong Reg No or password" });
  }
  const user = issueToken(res, e, jwtSecret);
  // signed in either way; a line someone else holds is explained on the test page, where another can be picked
  let problem: { message: string; code?: unknown; holder?: unknown } | null = null;
  try { await startTest(e.id, p.data.line_id); } catch (err) {
    if (!(err instanceof ConnectError)) throw err;
    problem = { message: err.message, ...err.extra };
  }
  return res.json({ user, problem });
});

router.post("/logout", async (req, res) => {
  // logging out frees the person's line (client, 28 Nov 2026); an expired or missing token just clears the cookie
  const secret = process.env.JWT_SECRET;
  const token = req.cookies?.token;
  if (secret && token) {
    try { await endMine((jwt.verify(token, secret) as { sub: string }).sub); } catch { /* not signed in: nothing to free */ }
  }
  const isProd = process.env.NODE_ENV === "production";
  res.clearCookie("token", {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "none" : "lax",
    path: "/",
    ...(process.env.COOKIE_DOMAIN ? { domain: process.env.COOKIE_DOMAIN } : {}),
  });
  return res.json({ ok: true });
});

router.get("/me", requireAuth, async (req, res) => {
  const userId = req.user?.sub;
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // permissions = the tabs ticked for this user (Users → Tabs); the Super Admin has all without rows
  const result = await pool.query(
    `SELECT e.id, e.name, e.email, e.role, e.color_index,
            ARRAY(SELECT permission FROM employee_permissions p WHERE p.employee_id = e.id) AS permissions
     FROM employees e WHERE e.id = $1 AND e.status = 'active' LIMIT 1`,
    [userId]
  );

  if (result.rows.length === 0) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // a User (rep) works only once connected to a line today; Admins and the Super Admin don't need one
  const me = result.rows[0];
  const connection = await currentConnection(me.id);
  return res.json({ ...me, connection, needs_connection: me.role === "employee" && !connection });
});

export default router;
