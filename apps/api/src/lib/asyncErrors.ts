/**
 * Express 4 ignores the promise an `async` handler returns, so a rejected one
 * (e.g. a failed query) became an unhandledRejection that killed the whole API
 * process. Forward those rejections to `next(err)` instead, for every route and
 * middleware at once. Same body as Express's own `handle_request`, plus `.catch`.
 * shortcut: patches Express 4 internals; delete this file when moving to Express 5,
 * which does this natively.
 */
import type { NextFunction, Request, Response } from "express";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Layer = require("express/lib/router/layer");

Layer.prototype.handle_request = function handle(req: Request, res: Response, next: NextFunction) {
  const fn = this.handle;
  if (fn.length > 3) return next(); // error handlers are invoked via handle_error
  try {
    const result = fn(req, res, next);
    if (result && typeof result.catch === "function") result.catch(next);
  } catch (err) {
    next(err);
  }
};

/** Last middleware: log the failure and answer 500 JSON instead of crashing. */
export function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction) {
  console.error(`${req.method} ${req.originalUrl} failed:`, err);
  if (res.headersSent) return next(err);
  return res.status(500).json({ error: "Internal server error" });
}
