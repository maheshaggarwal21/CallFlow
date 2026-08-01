import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import rateLimit from "express-rate-limit";
import path from "path";
import authRoutes from "./routes/auth.routes";
import callsRoutes from "./routes/calls.routes";
import analyticsRoutes from "./routes/analytics.routes";
import employeesRoutes from "./routes/employees.routes";
import intercomsRoutes from "./routes/intercoms.routes";
import linesRoutes from "./routes/lines.routes";
import systemRoutes from "./routes/system.routes";
import studentsRoutes from "./routes/students.routes";
import devRoutes from "./routes/dev.routes";
import { DEV_UPLOADS_DIR } from "./services/storage.service";

dotenv.config();

const app = express();

// Required when running behind nginx/reverse-proxy: tells Express to trust
// the X-Forwarded-For header so rate limiters key on the real client IP,
// not nginx's 127.0.0.1 (which would bucket all users together).
app.set("trust proxy", 1);

// Allow both local dev and the deployed frontend domain.
// Setting WEB_ORIGIN REPLACES the default rather than adding to it, so the
// localhost fallback below is dead in every deployed environment — hence the
// explicit dev-only entries.
const allowedOrigins = (process.env.WEB_ORIGIN || "http://localhost:3000")
  .split(",")
  .map((o) => o.trim().replace(/\/$/, ""))  // strip any accidental trailing slash
  .filter(Boolean);

// Local dev talks to a deployed API often enough to be worth allowing, but only
// off-production — never widen the production allowlist to include localhost.
if (process.env.NODE_ENV !== "production") {
  for (const o of ["http://localhost:3000", "http://127.0.0.1:3000"]) {
    if (!allowedOrigins.includes(o)) allowedOrigins.push(o);
  }
}

app.use(
  cors({
    origin: (origin, cb) => {
      // Allow requests with no Origin header (curl, mobile app, server-to-server)
      if (!origin) return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      // Disallowed origin is a CLIENT problem, so answer without the
      // Access-Control-Allow-Origin header and let the browser block it.
      // Passing an Error here instead made every stray request — including
      // internet background noise hitting the bare IP — surface as an
      // unhandled 500 with a stack trace in the error log.
      cb(null, false);
    },
    credentials: true,
  })
);
app.use(express.json({ limit: "10mb" }));
app.use(cookieParser());
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/calls", callsRoutes);
app.use("/api/v1/analytics", analyticsRoutes);
app.use("/api/v1/employees", employeesRoutes);
app.use("/api/v1/intercoms", intercomsRoutes);
app.use("/api/v1/lines", linesRoutes);
app.use("/api/v1/system", systemRoutes);
app.use("/api/v1/students", studentsRoutes);

// Dev-only: serve local audio files + test helpers (disabled in production)
if (process.env.NODE_ENV !== "production") {
  app.use("/dev-audio", express.static(DEV_UPLOADS_DIR, {
    setHeaders: (res) => {
      res.set("Access-Control-Allow-Origin", allowedOrigins[0]);
      res.set("Accept-Ranges", "bytes");
    },
  }));
  app.use("/api/v1/dev", devRoutes);
  console.log(`[DEV] Local audio served from: ${DEV_UPLOADS_DIR}`);
}

app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

const port = Number(process.env.PORT || 4000);
app.listen(port, () => {
  console.log(`API listening on port ${port}`);
});
