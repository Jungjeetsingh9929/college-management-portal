import "./config/loadEnv.js";
import { configuredClientOrigins, validateClientOrigins } from "./config/clientOrigin.js";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { databaseWriteLock, ensureDatabase, withWriteLock } from "./db/fileStore.js";
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
import { hodRouter } from "./routes/hod.js";
import { feesRouter } from "./routes/fees.js";
import { paymentsRouter, paymentWebhookHandler } from "./routes/payments.js";
import { paymentCspSources } from "./services/payments/index.js";
import { eventsRouter } from "./routes/events.js";
import { libraryRouter } from "./routes/library.js";
import { photosRouter } from "./routes/photos.js";
import { marksRouter } from "./routes/marks.js";
import { projectsRouter } from "./routes/projects.js";
import { clientKey, rateConfig, rateLimit } from "./middleware/rateLimit.js";
import { recordAudit, safeAuditValue } from "./services/auditService.js";

const app = express();
// `trust proxy` controls how many X-Forwarded-For hops Express trusts, which
// in turn feeds req.ip - used as the rate-limit identity (clientKey(), see
// middleware/rateLimit.js), the audit-log IP, and the masked IP shown in
// /auth/sessions. If this value doesn't match the real number of proxies in
// front of the app, a client can forge X-Forwarded-For to rotate its
// apparent IP on every request (defeating per-IP rate limits) or to spoof
// the IP recorded in the audit log. Defaulting to 1 assumes exactly one
// reverse proxy (e.g. a single Render/nginx load balancer) sits in front of
// this process - confirm that matches your actual deployment topology
// rather than trusting the default, and set TRUST_PROXY explicitly for
// anything else (0 for no proxy, a higher number for a longer chain).
if (process.env.TRUST_PROXY === undefined) {
  console.warn("[startup] TRUST_PROXY is not set; defaulting to 1 (trusts exactly one upstream proxy hop for X-Forwarded-For). Set TRUST_PROXY explicitly to match your deployment - an incorrect value lets clients spoof their IP for rate limiting and audit logs.");
}
app.set("trust proxy", process.env.TRUST_PROXY !== undefined ? process.env.TRUST_PROXY : 1);
const port = process.env.PORT || 5055;
const host = process.env.HOST || "127.0.0.1";
// CLIENT_ORIGIN doesn't only gate CORS - it's also the public origin baked
// into password-reset emails and (as a fallback) attendance check-in links.
// A wrong value there fails on the student's phone, far away from anyone who
// could notice, so validate it here at boot rather than discovering it from
// a classroom full of failed scans.
const originCheck = validateClientOrigins();
for (const warning of originCheck.warnings) console.warn(`[startup] ${warning}`);
if (originCheck.fatal.length) {
  for (const problem of originCheck.fatal) console.error(`[startup] ${problem}`);
  throw new Error("Refusing to start: CLIENT_ORIGIN/FRONTEND_URL is missing or invalid. See the errors above.");
}
const allowedOrigins = new Set(configuredClientOrigins());
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distPath = path.resolve(__dirname, "../dist");

app.use(
  cors({
    origin(origin, callback) {
      // The old condition ended in `|| isNonProduction`, which short-circuited
      // every other check and allowed *any* origin whenever NODE_ENV was
      // development or test - making both the allow-list and the
      // localhost-only pattern beside it dead code. Dev convenience is still
      // covered by localDevelopmentOrigin; anything else must be on the list.
      const isNonProduction = process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test";
      const localDevelopmentOrigin = isNonProduction && Boolean(origin) && /^(https?:\/\/)(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
      if (!origin || allowedOrigins.has(origin) || localDevelopmentOrigin) return callback(null, true);
      return callback(new Error("Origin is not allowed by CORS."));
    }
  })
);
// Razorpay Checkout needs a few extra CSP sources. They are added only when the
// payment provider is configured, so an unconfigured deployment keeps the
// original strict policy.
const paymentCsp = paymentCspSources();
app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'", ...paymentCsp.script], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", "data:", "blob:", "https://api.qrserver.com"], connectSrc: ["'self'", ...paymentCsp.connect], ...(paymentCsp.frame.length ? { frameSrc: ["'self'", ...paymentCsp.frame] } : {}), objectSrc: ["'none'"], baseUri: ["'self'"], formAction: ["'self'"], frameAncestors: ["'none'"] } }, hsts: process.env.NODE_ENV === "production" ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false }));
// Payment-provider webhook. It must be registered BEFORE express.json(): the
// signature is an HMAC over the exact raw bytes, which a parsed body can't
// reproduce. It is intentionally outside databaseWriteLock (the handler takes
// withWriteLock itself) and has its own rate limit; unsigned requests are
// rejected before any payment state is read or written.
app.post(
  "/api/payments/webhook",
  rateLimit({ ...rateConfig("PAYMENT_WEBHOOK", { windowMs: 60 * 1000, limit: 300 }), keyGenerator: clientKey, scope: "api:payment-webhook", message: "Too many webhook requests." }),
  express.raw({ type: () => true, limit: "100kb" }),
  paymentWebhookHandler
);
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
    // Read the path from req.originalUrl, not req.path. Every route here is
    // reached through a mounted sub-router (attendanceRouter, studentsRouter,
    // etc.), and Express's Router only restores req.url/req.path back to the
    // full mounted path inside the wrapped `next()` it hands to that
    // sub-router - i.e. when the sub-router falls through without matching,
    // or the handler explicitly calls next(). A handler that just answers
    // the request (res.json(), the normal case for every route below) never
    // calls that next(), so req.url/req.path stays trimmed to the
    // sub-router-relative path (e.g. "/mark" instead of "/api/attendance/mark")
    // for the rest of the request's lifetime, including this "finish"
    // listener, which runs after the response has already gone out. That
    // trimmed path fails the "/api" prefix check below, so this middleware
    // was silently skipping every mutating request instead of auditing it.
    // req.originalUrl is set once when the request arrives and is never
    // touched by that trimming, so it's the reliable source here.
    const requestPath = req.originalUrl.split("?")[0];
    if (!requestPath.startsWith("/api")) return;
    console.info(JSON.stringify({ type: "api_request", method: req.method, path: requestPath, status: res.statusCode, durationMs: Date.now() - started, requestId: req.headers["x-request-id"] || null }));
    if (!(["POST", "PUT", "PATCH", "DELETE"].includes(req.method) || res.statusCode >= 400)) return;
    const runAudit = () => recordAudit({ userId: req.user?.id, role: req.user?.role, action: `${req.method} ${requestPath}`, severity: res.statusCode >= 500 ? "critical" : res.statusCode >= 400 ? "warning" : "info", success: res.statusCode < 400, ip: req.ip, userAgent: req.get("user-agent"), target: requestPath, newValue: safeAuditValue(req.method === "GET" ? null : { status: res.statusCode }) }).catch(() => {});
    // For mutating requests, databaseWriteLock is active and exposes
    // req.onWriteLockRelease - piggyback on it so this audit write's own
    // readDb()->writeDb() cycle completes before the lock releases, instead
    // of racing a concurrent request's write outside the lock (see
    // databaseWriteLock in server/db/fileStore.js). Non-mutating requests
    // (a GET that 4xx/5xx'd) never acquire the lock via databaseWriteLock,
    // but runAudit() still does its own readDb()->writeDb() cycle, so it
    // must queue onto the same lock via withWriteLock - otherwise it can
    // read stale state and clobber a concurrent locked mutation's write
    // when its own write lands after.
    if (Array.isArray(req.onWriteLockRelease)) req.onWriteLockRelease.push(runAudit);
    else void withWriteLock(runAudit).catch(() => {});
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
  scope: "api",
  message: "Too many requests. Please try again later."
}));

// Declared once and mounted before the routers below, because feesRouter is
// mounted on bare "/api" and owns several /api/admin/fees* routes. It ran
// before the admin router's own limiter, so those admin endpoints were
// covered only by the loose global limiter.
const adminApiLimiter = rateLimit({ ...rateConfig("ADMIN_API", { windowMs: 60 * 1000, limit: 60, backoffBaseMs: 500, backoffMaxMs: 30000 }), keyGenerator: clientKey, scope: "api:admin", message: "Too many administrative requests. Please try again later." });
app.use("/api/admin", adminApiLimiter);

app.use("/api/auth", rateLimit({
  ...rateConfig("AUTH_API", { windowMs: 15 * 60 * 1000, limit: 100, backoffBaseMs: 500, backoffMaxMs: 60 * 1000 }),
  scope: "api:auth",
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
app.use("/api/hod", hodRouter);
app.use("/api", feesRouter);
app.use("/api", paymentsRouter);
app.use("/api/events", eventsRouter);
app.use("/api/library", libraryRouter);
app.use("/api/photos", photosRouter);
app.use("/api/marks", marksRouter);
app.use("/api/projects", projectsRouter);
app.use("/api/shared/search", rateLimit({ ...rateConfig("SEARCH_API", { windowMs: 60 * 1000, limit: 30, backoffBaseMs: 250, backoffMaxMs: 10000 }), keyGenerator: clientKey, scope: "api:search", message: "Too many search requests. Please try again later." }));
app.use("/api/shared", sharedRouter);
app.use("/api/admin", adminRouter);

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
  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    return res.status(400).json({ message: "Invalid JSON request body." });
  }
  // A blocked origin is a client error, not a server fault. It was logged as
  // "Unhandled request error" and answered with a 500, which both polluted
  // the logs and told the caller the wrong thing.
  if (err && err.message === "Origin is not allowed by CORS.") {
    return res.status(403).json({ message: "Origin is not allowed." });
  }
  // A body larger than the 100kb express.json limit also arrived here.
  if (err && err.type === "entity.too.large") {
    return res.status(413).json({ message: "Request body is too large." });
  }
  console.error("Unhandled request error:", err);
  if (res.headersSent) return;
  return res.status(500).json({ message: "Something went wrong on the server." });
});

await ensureDatabase();

if (process.env.NODE_ENV !== "test") {
  app.listen(port, host, () => {
    console.log(`Attendance API running at http://${host}:${port}`);
  });
}

export default app;
