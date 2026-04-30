import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";

export type UserRole = "owner" | "employee";

export type AuthUser = {
  sub: string;
  role: UserRole;
  name: string;
  color_index: number;
};

function getTokenFromRequest(req: Request): string | null {
  const header = req.headers.authorization || "";
  if (header.startsWith("Bearer ")) {
    return header.slice("Bearer ".length);
  }
  const cookieToken = req.cookies?.token;
  return cookieToken || null;
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    return res.status(500).json({ error: "Server misconfigured" });
  }

  const token = getTokenFromRequest(req);
  if (!token) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const payload = jwt.verify(token, jwtSecret) as AuthUser;
    req.user = {
      sub: payload.sub,
      role: payload.role,
      name: payload.name,
      color_index: payload.color_index,
    };
    return next();
  } catch {
    return res.status(401).json({ error: "Unauthorized" });
  }
}
