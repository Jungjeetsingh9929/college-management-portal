import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { Router } from "express";
import { makeId, readDb, writeDb } from "../db/fileStore.js";
import { consumeRefreshToken, createRefreshToken, getAccount, requireAuth, revokeRefreshToken, signToken } from "../middleware/auth.js";
import { publicStudent } from "../services/attendanceService.js";
import { clientKey, rateConfig, rateLimit } from "../middleware/rateLimit.js";
import { PASSWORD_REQUIREMENTS, requiredText, validEmail, validPassword, validateKeys } from "../services/validation.js";
import { recordAudit } from "../services/auditService.js";

export const authRouter = Router();
const loginIpConfig = rateConfig("AUTH_LOGIN_IP", { windowMs: 15 * 60 * 1000, limit: 20, backoffBaseMs: 1000, backoffMaxMs: 60 * 1000 });
const loginAccountConfig = rateConfig("AUTH_LOGIN_ACCOUNT", { windowMs: 15 * 60 * 1000, limit: 8, backoffBaseMs: 2000, backoffMaxMs: 5 * 60 * 1000 });
const signupConfig = rateConfig("AUTH_SIGNUP", { windowMs: 60 * 60 * 1000, limit: 10, backoffBaseMs: 2000, backoffMaxMs: 10 * 60 * 1000 });
const digestToken = (value) => crypto.createHash("sha256").update(String(value)).digest("hex");
function invalidateUserSessions(db, userId) { Object.values(db.refreshTokens || {}).forEach((session) => { if (session.userId === userId && !session.revokedAt) session.revokedAt = new Date().toISOString(); }); }
function passwordWasUsed(account, password) { return [account.password, ...(account.passwordHistory || [])].some((hash) => hash && bcrypt.compareSync(String(password), hash)); }
function maskedIp(value) { const ip = String(value || ""); if (!ip || ip === "unknown") return null; if (ip.includes(".")) return `${ip.split(".").slice(0, 2).join(".")}.*.*`; return `${ip.split(":").slice(0, 2).join(":")}::/32`; }

authRouter.post("/login", rateLimit({
  ...loginIpConfig,
  message: "Too many login attempts for this account. Please try again later.",
  keyGenerator: clientKey
}), rateLimit({
  ...loginAccountConfig,
  keyGenerator: (req) => String(req.body?.email || "unknown").trim().toLowerCase(),
  message: "Too many login attempts for this account. Please try again later."
}), async (req, res) => {
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
    return res.status(400).json({ message: "Invalid login request." });
  }
  try { validateKeys(req.body, ["email", "password", "role"]); } catch { return res.status(400).json({ message: "Invalid login request." }); }
  const { email, password, role } = req.body;
  if (!validEmail(email) || !validPassword(password) || !["admin", "teacher", "student"].includes(role)) {
    return res.status(401).json({ message: "Invalid email, password, or role." });
  }
  const db = await readDb();
  let collection;
  if (role === "admin") collection = db.admins;
  else if (role === "teacher") collection = db.teachers || [];
  else collection = db.students;
  
  const userRole = role === "admin" ? "admin" : role === "teacher" ? "teacher" : "student";
  const user = collection.find((item) => String(item.email || "").toLowerCase() === String(email).trim().toLowerCase());

  if (!user || !user.password || !bcrypt.compareSync(String(password), user.password)) {
    await recordAudit({ action: "auth.login.failed", severity: "warning", success: false, ip: req.ip, userAgent: req.get("user-agent"), target: `account:${digestToken(email).slice(0, 12)}` });
    return res.status(401).json({ message: "Invalid email, password, or role." });
  }
  if (user.active === false) { await recordAudit({ userId: user.id, role: userRole, action: "auth.login.blocked_inactive", severity: "warning", success: false, ip: req.ip, userAgent: req.get("user-agent"), target: user.id }); return res.status(403).json({ message: "This account is inactive. Contact an administrator." }); }
  if (role === "student" && user.approvalStatus && user.approvalStatus !== "approved") {
    return res.status(403).json({ message: "Student ID is not approved by admin yet." });
  }

  const session = await createRefreshToken({ ...user, role: userRole }, db, { device: req.headers["user-agent"], ip: req.ip, userAgent: req.get("user-agent") });
  const token = signToken({ ...user, role: userRole, sessionId: session.sessionId });
  const safeUser =
    userRole === "student"
      ? { ...publicStudent(user, db.attendance), role: userRole }
      : userRole === "teacher"
      ? { id: user.id, name: user.name, email: user.email, code: user.code, department: user.department, role: userRole }
      : { id: user.id, name: user.name, email: user.email, role: userRole };

  await recordAudit({ userId: user.id, role: userRole, action: "auth.login.success", severity: "info", ip: req.ip, userAgent: req.get("user-agent"), target: user.id });
  res.json({ token, refreshToken: session.token, sessionId: session.sessionId, expiresIn: process.env.ACCESS_TOKEN_TTL || "15m", user: safeUser });
});

authRouter.post("/refresh", async (req, res) => {
  const raw = req.body?.refreshToken; if (typeof raw !== "string" || raw.length < 40) return res.status(401).json({ message: "Refresh token is required." });
  const db = await readDb(); const stored = await consumeRefreshToken(raw, db); if (!stored) return res.status(401).json({ message: "Refresh token is invalid or expired." });
  const account = getAccount(db, { id: stored.userId, role: stored.role }); if (!account || account.active === false || (account.passwordVersion || 0) !== (stored.passwordVersion || 0)) return res.status(401).json({ message: "Refresh token is no longer valid." });
  const user = { ...account, role: stored.role }; const session = await createRefreshToken(user, db, { device: req.headers["user-agent"], ip: req.ip, userAgent: req.get("user-agent") }); const token = signToken({ ...user, sessionId: session.sessionId }); res.json({ token, refreshToken: session.token, sessionId: session.sessionId, expiresIn: process.env.ACCESS_TOKEN_TTL || "15m" });
});

authRouter.post("/logout", async (req, res) => { if (typeof req.body?.refreshToken === "string") { const db = await readDb(); await revokeRefreshToken(req.body.refreshToken, db); } res.json({ ok: true }); });

authRouter.get("/sessions", requireAuth, async (req, res) => { const db = await readDb(); const now = new Date(); const sessions = Object.values(db.refreshTokens || {}).filter((item) => item.userId === req.user.id && !item.revokedAt && new Date(item.expiresAt) > now).map((item) => ({ sessionId: item.sessionId, device: item.device || "Unknown device", userAgent: item.userAgent || "Unknown browser", ip: maskedIp(item.ip), createdAt: item.createdAt, lastActiveAt: item.lastActiveAt || item.createdAt, expiresAt: item.expiresAt, current: item.sessionId === req.user.sessionId })); res.json({ sessions }); });
authRouter.post("/sessions/:sessionId/revoke", requireAuth, async (req, res) => { const db = await readDb(); const session = Object.values(db.refreshTokens || {}).find((item) => item.sessionId === req.params.sessionId && item.userId === req.user.id && !item.revokedAt); if (!session) return res.status(404).json({ message: "Session not found." }); session.revokedAt = new Date().toISOString(); await writeDb(db); res.json({ ok: true, current: session.sessionId === req.user.sessionId }); });
authRouter.post("/sessions/logout-others", requireAuth, async (req, res) => { const db = await readDb(); let revoked = 0; Object.values(db.refreshTokens || {}).forEach((session) => { if (session.userId === req.user.id && session.sessionId !== req.user.sessionId && !session.revokedAt) { session.revokedAt = new Date().toISOString(); revoked += 1; } }); await writeDb(db); res.json({ ok: true, revoked }); });

authRouter.post("/request-password-reset", rateLimit({ ...signupConfig, message: "Too many password reset requests. Please try again later." }), async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase(); if (!validEmail(email)) return res.status(400).json({ message: "A valid email is required." }); const db = await readDb(); db.passwordResets ||= {}; const account = [...(db.admins || []), ...(db.teachers || []), ...(db.students || [])].find((item) => String(item.email).toLowerCase() === email); if (account) { const raw = crypto.randomBytes(32).toString("base64url"); db.passwordResets[digestToken(raw)] = { userId: account.id, expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString() }; await writeDb(db); if (process.env.NODE_ENV === "test") return res.json({ ok: true, resetToken: raw }); } return res.json({ ok: true, message: "If the account exists, password reset instructions have been sent." });
});

authRouter.post("/reset-password", async (req, res) => { const token = String(req.body?.token || ""); const password = req.body?.newPassword; if (token.length < 40 || !validPassword(password)) return res.status(400).json({ message: `A valid reset token and a ${PASSWORD_REQUIREMENTS.toLowerCase()} are required.` }); const db = await readDb(); db.passwordResets ||= {}; const record = db.passwordResets[digestToken(token)]; if (!record || new Date(record.expiresAt) <= new Date()) return res.status(400).json({ message: "Reset token is invalid or expired." }); const account = getAccount(db, { id: record.userId, role: "student" }) || getAccount(db, { id: record.userId, role: "teacher" }) || getAccount(db, { id: record.userId, role: "admin" }); if (!account || passwordWasUsed(account, password)) return res.status(400).json({ message: "Choose a password that has not been used recently." }); account.passwordHistory = [account.password, ...(account.passwordHistory || [])].filter(Boolean).slice(0, 5); account.password = bcrypt.hashSync(String(password), 12); account.passwordVersion = (account.passwordVersion || 0) + 1; invalidateUserSessions(db, account.id); delete db.passwordResets[digestToken(token)]; await writeDb(db); res.json({ ok: true, message: "Password reset successfully. Please sign in again." }); });

authRouter.post("/student-request", rateLimit({
  ...signupConfig,
  message: "Too many registration requests. Please try again later."
}), async (req, res) => {
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) return res.status(400).json({ message: "Invalid registration request." });
  try { validateKeys(req.body, ["name", "rollNumber", "email", "password", "className", "department", "phone", "guardian", "graduationYear"]); } catch { return res.status(400).json({ message: "Invalid registration request." }); }
  const db = await readDb();
  db.pendingStudents ||= [];
  const email = String(req.body.email || "").trim().toLowerCase();
  const rollNumber = String(req.body.rollNumber || "").trim();

  if (!validEmail(email) || !validPassword(req.body.password)) {
    return res.status(400).json({ message: `Name, roll number, email, and a ${PASSWORD_REQUIREMENTS.toLowerCase()} are required.` });
  }
  let name;
  try { name = requiredText(req.body.name, "Name", { max: 120 }); } catch { return res.status(400).json({ message: "Name is invalid." }); }
  if (!rollNumber || rollNumber.length > 40) return res.status(400).json({ message: "Roll number is invalid." });
  for (const [field, max] of [["className", 80], ["department", 100], ["phone", 30], ["guardian", 120], ["graduationYear", 10]]) {
    if (req.body[field] !== undefined) { try { requiredText(req.body[field], field, { min: 0, max }); } catch { return res.status(400).json({ message: "Invalid registration request." }); } }
  }

  const emailExists = db.students.some((student) => student.email.toLowerCase() === email);
  const pendingExists = db.pendingStudents.some((student) => student.email.toLowerCase() === email);
  if (emailExists || pendingExists) {
    return res.status(409).json({ message: "This email already has an account or pending request." });
  }

  const request = {
    id: makeId("req"),
    name,
    rollNumber,
    className: req.body.className || "CSE 3A",
    department: req.body.department || "Computer Science",
    email,
    password: bcrypt.hashSync(req.body.password, 12),
    phone: req.body.phone || "",
    guardian: req.body.guardian || "",
    graduationYear: req.body.graduationYear || "2028",
    approvalStatus: "pending",
    createdAt: new Date().toISOString()
  };

  db.pendingStudents.unshift(request);
  await writeDb(db);
  res.status(201).json({
    success: true,
    message: "Student ID request sent to admin for approval.",
    request: {
      id: request.id,
      name: request.name,
      rollNumber: request.rollNumber,
      email: request.email,
      approvalStatus: request.approvalStatus
    }
  });
});

authRouter.post("/change-password", requireAuth, async (req, res) => {
  try { validateKeys(req.body || {}, ["currentPassword", "newPassword"]); } catch { return res.status(400).json({ message: "Invalid password change request." }); }
  const { currentPassword, newPassword } = req.body;
  if (!validPassword(currentPassword) || !validPassword(newPassword)) {
    return res.status(400).json({
      message: `Current password and a new ${PASSWORD_REQUIREMENTS.toLowerCase()} are required.`
    });
  }

  const db = await readDb();
  let collection;
  if (req.user.role === "admin") collection = db.admins;
  else if (req.user.role === "teacher") collection = db.teachers || [];
  else collection = db.students;

  const account = (collection || []).find((item) => item.id === req.user.id);
  if (!account || !account.password) {
    return res.status(404).json({ message: "Account not found." });
  }

  if (!bcrypt.compareSync(String(currentPassword), account.password)) {
    return res.status(401).json({ message: "Current password is incorrect." });
  }

  if (passwordWasUsed(account, newPassword)) return res.status(400).json({ message: "Choose a password that has not been used recently." });

  account.passwordHistory = [account.password, ...(account.passwordHistory || [])].filter(Boolean).slice(0, 5);
  account.password = bcrypt.hashSync(String(newPassword), 12);
  account.passwordVersion = (account.passwordVersion || 0) + 1;
  invalidateUserSessions(db, account.id);
  await writeDb(db);

  res.json({ success: true, message: "Password updated. Please sign in again on this device." });
});

authRouter.get("/me", requireAuth, async (req, res) => {
  const db = await readDb();
  if (req.user.role === "admin") {
    const admin = db.admins.find((item) => item.id === req.user.id);
    if (!admin) return res.status(404).json({ message: "User not found." });
    return res.json({ user: { id: admin.id, name: admin.name, email: admin.email, role: "admin" } });
  }
  
  if (req.user.role === "teacher") {
    const teacher = (db.teachers || []).find((item) => item.id === req.user.id);
    if (!teacher) return res.status(404).json({ message: "User not found." });
    return res.json({ user: { id: teacher.id, name: teacher.name, email: teacher.email, code: teacher.code, department: teacher.department, role: "teacher" } });
  }

  const student = db.students.find((item) => item.id === req.user.id);
  if (!student) return res.status(404).json({ message: "User not found." });
  res.json({ user: { ...publicStudent(student, db.attendance), role: "student" } });
});
