import { NextFunction, Request, Response } from "express";
import pool from "../db/pool";
import type { Permission } from "../lib/crm/rules";

/**
 * CRM permission check, read from the database on every request so a change in
 * Team permissions applies immediately (the JWT is unchanged). The owner has
 * every permission. Passes when the user holds ANY of the listed permissions.
 */
export function requirePermission(...names: Permission[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    if (req.user.role === "owner") return next();
    const { rows } = await pool.query(
      `SELECT 1 FROM employee_permissions p JOIN employees e ON e.id = p.employee_id
       WHERE p.employee_id = $1 AND p.permission = ANY($2) AND e.status = 'active' LIMIT 1`,
      [req.user.sub, names]
    );
    if (!rows.length) return res.status(403).json({ error: "Forbidden", message: "You don't have permission for this" });
    return next();
  };
}
