import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import rateLimit from "express-rate-limit";
import path from "path";
import authRoutes from "./routes/auth.routes";
import callsRoutes from "./routes/calls.routes";
import analyticsRoutes from "./routes/analytics.routes";
import devicesRoutes from "./routes/devices.routes";
import employeesRoutes from "./routes/employees.routes";
import intercomsRoutes from "./routes/intercoms.routes";
import linesRoutes from "./routes/lines.routes";
import mobileRoutes from "./routes/mobile.routes";
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

// Allow both local dev and the deployed frontend domain
const allowedOrigins = (process.env.WEB_ORIGIN || "http://localhost:3000")
  .split(",")
  .map((o) => o.trim().replace(/\/$/, ""))  // strip any accidental trailing slash
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, cb) => {
      // Allow requests with no Origin header (curl, mobile app, server-to-server)
      if (!origin) return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      cb(new Error(`CORS: origin ${origin} not allowed`));
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
app.use("/api/v1/devices", devicesRoutes);
app.use("/api/v1/employees", employeesRoutes);
app.use("/api/v1/intercoms", intercomsRoutes);
app.use("/api/v1/lines", linesRoutes);
app.use("/api/v1/mobile", mobileRoutes);
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
