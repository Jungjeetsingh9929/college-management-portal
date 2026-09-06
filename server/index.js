import "./config/loadEnv.js";
import cors from "cors";
import express from "express";
import helmet from "helmet";
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
import { clientKey, rateConfig, rateLimit } from "./middleware/rateLimit.js";
import { recordAudit, safeAuditValue } from "./services/auditService.js";

const app = express();
app.set("trust proxy", process.env.TRUST_PROXY || 1);
const port = process.env.PORT || 5055;
const host = process.env.HOST || "127.0.0.1";
const allowedOrigins = new Set(
  String(process.env.CLIENT_ORIGIN || process.env.FRONTEND_URL || "")
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
app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", "data:", "blob:"], connectSrc: ["'self'"], objectSrc: ["'none'"], baseUri: ["'self'"], formAction: ["'self'"], frameAncestors: ["'none'"] } }, hsts: process.env.NODE_ENV === "production" ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false }));
app.use(express.json({ limit: "100kb" }));
app.use((req, res, next) => {
  if (["POST", "PUT", "PATCH"].includes(req.method) && req.is("application/json") &&
      (!req.body || typeof req.body !== "object" || Array.isArray(req.body))) {
    return res.status(400).json({ message: "Request body must be a JSON object." });
  }
  next();
});
app.use(databaseWriteLock);
app.use((req, res, next) => {
  const started = Date.now();
  res.once("finish", () => {
    if (!req.path.startsWith("/api")) return;
    console.info(JSON.stringify({ type: "api_request", method: req.method, path: req.path, status: res.statusCode, durationMs: Date.now() - started, requestId: req.headers["x-request-id"] || null }));
    if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method) || res.statusCode >= 400) void recordAudit({ userId: req.user?.id, role: req.user?.role, action: `${req.method} ${req.path}`, severity: res.statusCode >= 500 ? "critical" : res.statusCode >= 400 ? "warning" : "info", success: res.statusCode < 400, ip: req.ip, userAgent: req.get("user-agent"), target: req.path, newValue: safeAuditValue(req.method === "GET" ? null : { status: res.statusCode }) }).catch(() => {});
  });
  next();
});
app.use((req, res, next) => {
  res.set("X-Content-Type-Options", "nosniff");
  res.set("X-Frame-Options", "DENY");
  res.set("Referrer-Policy", "same-origin");
  res.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(self)");
  if (req.path.startsWith("/api")) res.set("Cache-Control", "no-store");
  if (process.env.NODE_ENV === "production") res.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  next();
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "College Management API" });
});

app.use("/api", rateLimit({
  ...rateConfig("PUBLIC_API", { windowMs: 60 * 1000, limit: 120, backoffBaseMs: 250, backoffMaxMs: 10 * 1000 }),
  keyGenerator: clientKey,
  message: "Too many requests. Please try again later."
}));

app.use("/api/auth", rateLimit({
  ...rateConfig("AUTH_API", { windowMs: 15 * 60 * 1000, limit: 100, backoffBaseMs: 500, backoffMaxMs: 60 * 1000 }),
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
app.use("/api/shared/search", rateLimit({ ...rateConfig("SEARCH_API", { windowMs: 60 * 1000, limit: 30, backoffBaseMs: 250, backoffMaxMs: 10000 }), keyGenerator: clientKey, message: "Too many search requests. Please try again later." }));
app.use("/api/shared", sharedRouter);
app.use("/api/admin", rateLimit({ ...rateConfig("ADMIN_API", { windowMs: 60 * 1000, limit: 60, backoffBaseMs: 500, backoffMaxMs: 30000 }), keyGenerator: clientKey, message: "Too many administrative requests. Please try again later." }), adminRouter);

app.use("/api", (_req, res) => {
  res.status(404).json({ message: "API route not found." });
});

if (process.env.NODE_ENV === "production") {
  app.use(express.static(distPath));
  app.get("/{*splat}", (_req, res) => {
    res.sendFile(path.join(distPath, "index.html"));
  });
}

app.use((err, _req, res, _next) => {
  console.error("Unhandled request error:", err);
  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    return res.status(400).json({ message: "Invalid JSON request body." });
  }
  return res.status(500).json({ message: "Something went wrong on the server." });
});

await ensureDatabase();

if (process.env.NODE_ENV !== "test") {
  app.listen(port, host, () => {
    console.log(`Attendance API running at http://${host}:${port}`);
  });
}

export default app;
