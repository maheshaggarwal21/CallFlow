import { NextFunction, Request, Response } from "express";

/**
 * Tab / permission check (Users → Tabs checklist). requireAuth has already read the user's rank and
 * ticked tabs from the database for this request. The Super Admin (owner) has every permission.
 * Passes when the user holds ANY of the listed keys.
 */
export function requirePermission(...names: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    if (req.user.role === "owner" || names.some((n) => req.user!.permissions.includes(n))) return next();
    return res.status(403).json({ error: "Forbidden", message: "You don't have permission for this" });
  };
}
