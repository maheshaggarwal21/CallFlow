import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import rateLimit from "express-rate-limit";
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

dotenv.config();

const app = express();
const webOrigin = process.env.WEB_ORIGIN || "http://localhost:3000";

app.use(cors({ origin: webOrigin, credentials: true }));
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

app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

const port = Number(process.env.PORT || 4000);
app.listen(port, () => {
  console.log(`API listening on port ${port}`);
});
