import { NextFunction, Request, Response } from "express";

export function requireOwner(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (req.user.role !== "owner") {
    return res.status(403).json({ error: "Forbidden" });
  }
  return next();
}
