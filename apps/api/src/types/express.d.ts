import "express";
import type { AuthUser } from "../middleware/auth";

declare module "express-serve-static-core" {
  interface Request {
    user?: AuthUser;
  }
}
