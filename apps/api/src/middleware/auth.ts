import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import pool from "../db/pool";

// owner = Super Admin (everything) · admin = Admin (everyone's data, ticked tabs) · employee = User (own data, ticked tabs)
export type UserRole = "owner" | "admin" | "employee";

export type AuthUser = {
  sub: string;
  role: UserRole;
  name: string;
  color_index: number;
  /** Tabs ticked for this user, read fresh on every request (the Super Admin has all without rows). */
  permissions: string[];
};

function getTokenFromRequest(req: Request): string | null {
  const header = req.headers.authorization || "";
  if (header.startsWith("Bearer ")) {
    return header.slice("Bearer ".length);
  }
  const cookieToken = req.cookies?.token;
  return cookieToken || null;
}

/**
 * The token proves who is signing in; rank, status and ticked tabs are read from the database on every
 * request, so switching someone off or changing their rank applies at once, not when the 8 h token expires.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    return res.status(500).json({ error: "Server misconfigured" });
  }

  const token = getTokenFromRequest(req);
  if (!token) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  let payload: AuthUser;
  try {
    payload = jwt.verify(token, jwtSecret) as AuthUser;
  } catch {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const { rows: [u] } = await pool.query(
    `SELECT e.role, e.name, e.color_index, ARRAY(SELECT permission FROM employee_permissions p WHERE p.employee_id = e.id) AS permissions
     FROM employees e WHERE e.id = $1 AND e.status = 'active'`,
    [payload.sub]
  );
  if (!u) return res.status(401).json({ error: "Unauthorized" });
  req.user = { sub: payload.sub, role: u.role, name: u.name, color_index: u.color_index, permissions: u.permissions };
  return next();
}
