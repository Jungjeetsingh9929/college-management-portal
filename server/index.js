import "./config/loadEnv.js";
import cors from "cors";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { databaseWriteLock, ensureDatabase } from "./db/fileStore.js";
import { attendanceRouter } from "./routes/attendance.js";
import { authRouter } from "./routes/auth.js";
import { complaintsRouter } from "./routes/complaints.js";
import { reportsRouter } from "./routes/reports.js";
import { schedulesRouter } from "./routes/schedules.js";
import { studentsRouter } from "./routes/students.js";
import { subjectsRouter } from "./routes/subjects.js";
import { teachersRouter } from "./routes/teachers.js";
import { facultyRouter } from "./routes/faculty.js";
import { sharedRouter } from "./routes/shared.js";
import { adminRouter } from "./routes/admin.js";
import { rateLimit } from "./middleware/rateLimit.js";

const app = express();
app.set("trust proxy", process.env.TRUST_PROXY || 1);
const port = process.env.PORT || 5055;
const host = process.env.HOST || "127.0.0.1";
const allowedOrigins = new Set(
  String(process.env.CLIENT_ORIGIN || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distPath = path.resolve(__dirname, "../dist");

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) return callback(null, true);
      return callback(new Error("Origin is not allowed by CORS."));
    }
  })
);
app.use(express.json({ limit: "100kb" }));
app.use(databaseWriteLock);
app.use((req, res, next) => {
  res.set("X-Content-Type-Options", "nosniff");
  res.set("X-Frame-Options", "DENY");
  res.set("Referrer-Policy", "same-origin");
  next();
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "College Management API" });
});

app.use("/api/auth", rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 100,
  message: "Too many authentication requests. Please try again later."
}), authRouter);
app.use("/api/students", studentsRouter);
app.use("/api/subjects", subjectsRouter);
app.use("/api/attendance", attendanceRouter);
app.use("/api/complaints", complaintsRouter);
app.use("/api/reports", reportsRouter);
app.use("/api/schedules", schedulesRouter);
app.use("/api/teachers", teachersRouter);
app.use("/api/faculty", facultyRouter);
app.use("/api/shared", sharedRouter);
app.use("/api/admin", adminRouter);

if (process.env.NODE_ENV === "production") {
  app.use(express.static(distPath));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(distPath, "index.html"));
  });
}

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ message: "Something went wrong on the server." });
});

await ensureDatabase();

if (process.env.NODE_ENV !== "test") {
  app.listen(port, host, () => {
    console.log(`Attendance API running at http://${host}:${port}`);
  });
}

export default app;
