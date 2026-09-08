import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { Router } from "express";
import { makeId, readDb, writeDb } from "../db/fileStore.js";
import { consumeRefreshToken, createRefreshToken, getAccount, requireAuth, revokeRefreshToken, signToken } from "../middleware/auth.js";
import { publicStudent } from "../services/attendanceService.js";
import { clientKey, rateConfig, rateLimit } from "../middleware/rateLimit.js";
import { PASSWORD_REQUIREMENTS, requiredText, validEmail, validPassword, validateKeys } from "../services/validation.js";
import { recordAudit } from "../services/auditService.js";
import { sendOtpEmail, sendPasswordResetEmail } from "../services/emailService.js";

export const authRouter = Router();
const loginIpConfig = rateConfig("AUTH_LOGIN_IP", { windowMs: 15 * 60 * 1000, limit: 20, backoffBaseMs: 1000, backoffMaxMs: 60 * 1000 });
const loginAccountConfig = rateConfig("AUTH_LOGIN_ACCOUNT", { windowMs: 15 * 60 * 1000, limit: 8, backoffBaseMs: 2000, backoffMaxMs: 5 * 60 * 1000 });
const signupConfig = rateConfig("AUTH_SIGNUP", { windowMs: 60 * 60 * 1000, limit: 10, backoffBaseMs: 2000, backoffMaxMs: 10 * 60 * 1000 });
const digestToken = (value) => crypto.createHash("sha256").update(String(value)).digest("hex");
// A precomputed dummy bcrypt hash (of a value nobody will ever type) so a
// login for a nonexistent email still pays the same bcrypt cost as a real
// one, instead of returning early and leaking account existence via timing.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync("no-such-account-timing-guard", 12);
function invalidateUserSessions(db, userId) { Object.values(db.refreshTokens || {}).forEach((session) => { if (session.userId === userId && !session.revokedAt) session.revokedAt = new Date().toISOString(); }); }
function passwordWasUsed(account, password) { return [account.password, ...(account.passwordHistory || [])].some((hash) => hash && bcrypt.compareSync(String(password), hash)); }
function maskedIp(value) { const ip = String(value || ""); if (!ip || ip === "unknown") return null; if (ip.includes(".")) return `${ip.split(".").slice(0, 2).join(".")}.*.*`; return `${ip.split(":").slice(0, 2).join(":")}::/32`; }
function makeOtp() { return String(crypto.randomInt(100000, 1000000)); }
function otpDigest(value) { return digestToken(`otp:${value}`); }
function allAccounts(db) { return [...(db.admins || []), ...(db.students || []), ...(db.teachers || [])]; }
function accountForEmail(db, email) { return allAccounts(db).find((item) => String(item.email || "").toLowerCase() === String(email).trim().toLowerCase()); }

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

  // Always run a bcrypt compare, even when there's no matching account, so a
  // nonexistent email takes the same time as a wrong password on a real one
  // (see DUMMY_PASSWORD_HASH above) - otherwise the early-exit made account
  // existence detectable purely from response time.
  const passwordMatches = bcrypt.compareSync(String(password), user?.password || DUMMY_PASSWORD_HASH);
  if (!user || !user.password || !passwordMatches) {
    await recordAudit({ action: "auth.login.failed", severity: "warning", success: false, ip: req.ip, userAgent: req.get("user-agent"), target: `account:${digestToken(email).slice(0, 12)}` });
    return res.status(401).json({ message: "Invalid email, password, or role." });
  }
  if (user.active === false) { await recordAudit({ userId: user.id, role: userRole, action: "auth.login.blocked_inactive", severity: "warning", success: false, ip: req.ip, userAgent: req.get("user-agent"), target: user.id }); return res.status(403).json({ message: "This account is inactive. Contact an administrator." }); }
  if (role === "student" && user.approvalStatus && user.approvalStatus !== "approved") {
    return res.status(403).json({ message: "Student ID is not approved by admin yet." });
  }

  const session = await createRefreshToken({ ...user, role: userRole }, db, { device: req.headers["user-agent"], ip: req.ip, userAgent: req.get("user-agent") });
  const token = signToken({ ...user, role: userRole, sessionId: session.sessionId });
  const hodDepartment = userRole === "teacher" ? (db.departments || []).find((item) => item.hodId === user.id) : null;
  const safeUser =
    userRole === "student"
      ? { ...publicStudent(user, db.attendance), role: userRole }
      : userRole === "teacher"
      ? { id: user.id, name: user.name, email: user.email, code: user.code, department: user.department, role: userRole, isHod: Boolean(hodDepartment), hodDepartmentId: hodDepartment?.id || null, hodDepartment: hodDepartment?.name || null }
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

authRouter.post("/signup/request-otp", rateLimit({ ...signupConfig, message: "Too many signup requests. Please try again later." }), async (req, res) => {
  const requestedRole = req.body?.role === "faculty" ? "faculty" : req.body?.role === "student" ? "student" : "";
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = req.body?.password;
  if (!requestedRole || !validEmail(email) || !validPassword(password)) return res.status(400).json({ message: `Name, email, role, and a ${PASSWORD_REQUIREMENTS.toLowerCase()} are required.` });
  const db = await readDb();
  if (accountForEmail(db, email) || (db.pendingAccessRequests || []).some((item) => item.email === email && item.status === "pending")) return res.status(409).json({ message: "This email already has an account or pending request." });
  const otp = makeOtp();
  db.signupOtps ||= {};
  db.signupOtps[email] = { email, requestedRole, payload: { ...req.body, email, password: bcrypt.hashSync(String(password), 12) }, otpHash: otpDigest(otp), attempts: 0, expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString() };
  await writeDb(db);
  await sendOtpEmail({ to: email, name: req.body?.name, otp, purpose: "signup" });
  res.json({ ok: true, message: "A verification code was sent to your email. It expires in 10 minutes." });
});

authRouter.post("/signup/verify-otp", rateLimit({ ...signupConfig, message: "Too many verification attempts. Please try again later." }), async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const otp = String(req.body?.otp || "").trim();
  if (!validEmail(email) || !/^\d{6}$/.test(otp)) return res.status(400).json({ message: "A valid email and six-digit code are required." });
  const db = await readDb(); db.signupOtps ||= {};
  const record = db.signupOtps[email];
  if (!record || record.expiresAt <= new Date().toISOString() || record.attempts >= 5 || record.otpHash !== otpDigest(otp)) {
    if (record) { record.attempts = (record.attempts || 0) + 1; await writeDb(db); }
    return res.status(400).json({ message: "That verification code is invalid or expired." });
  }
  db.pendingAccessRequests ||= [];
  const payload = record.payload;
  db.pendingAccessRequests.unshift({ id: makeId("access"), name: requiredText(payload.name, "Name", { max: 120 }), requestedRole: record.requestedRole, email, password: payload.password, rollNumber: String(payload.rollNumber || "").slice(0, 40), className: String(payload.className || "").slice(0, 80), department: String(payload.department || "").slice(0, 100), phone: String(payload.phone || "").slice(0, 30), guardian: String(payload.guardian || "").slice(0, 120), graduationYear: String(payload.graduationYear || "").slice(0, 10), emailVerified: true, status: "pending", createdAt: new Date().toISOString() });
  delete db.signupOtps[email]; await writeDb(db);
  res.status(201).json({ ok: true, message: "Email verified. Your access request is now waiting for admin approval." });
});

authRouter.post("/request-password-otp", rateLimit({ ...signupConfig, message: "Too many password reset requests. Please try again later." }), async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  if (!validEmail(email)) return res.status(400).json({ message: "If the account exists, a verification code has been sent." });
  const db = await readDb(); const account = accountForEmail(db, email);
  if (account) {
    const otp = makeOtp(); db.passwordOtps ||= {};
    db.passwordOtps[email] = { userId: account.id, otpHash: otpDigest(otp), attempts: 0, expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString() };
    await writeDb(db); await sendOtpEmail({ to: email, name: account.name, otp, purpose: "password" });
  }
  res.json({ ok: true, message: "If the account exists, a verification code has been sent." });
});

authRouter.post("/reset-password-otp", rateLimit({ ...signupConfig, message: "Too many password reset attempts. Please try again later." }), async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase(); const otp = String(req.body?.otp || "").trim(); const newPassword = req.body?.newPassword;
  if (!validEmail(email) || !/^\d{6}$/.test(otp) || !validPassword(newPassword)) return res.status(400).json({ message: `A valid email, six-digit code, and a ${PASSWORD_REQUIREMENTS.toLowerCase()} are required.` });
  const db = await readDb(); db.passwordOtps ||= {}; const record = db.passwordOtps[email];
  if (!record || record.expiresAt <= new Date().toISOString() || record.attempts >= 5 || record.otpHash !== otpDigest(otp)) { if (record) { record.attempts = (record.attempts || 0) + 1; await writeDb(db); } return res.status(400).json({ message: "That verification code is invalid or expired." }); }
  const account = getAccount(db, { id: record.userId, role: "student" }) || getAccount(db, { id: record.userId, role: "teacher" }) || getAccount(db, { id: record.userId, role: "admin" });
  if (!account || passwordWasUsed(account, newPassword)) return res.status(400).json({ message: "Choose a password that has not been used recently." });
  account.passwordHistory = [account.password, ...(account.passwordHistory || [])].filter(Boolean).slice(0, 5); account.password = bcrypt.hashSync(String(newPassword), 12); account.passwordVersion = (account.passwordVersion || 0) + 1; invalidateUserSessions(db, account.id); delete db.passwordOtps[email]; await writeDb(db);
  res.json({ ok: true, message: "Password reset successfully. Please sign in again." });
});

authRouter.post("/request-password-reset", rateLimit({ ...signupConfig, message: "Too many password reset requests. Please try again later." }), async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  if (!validEmail(email)) return res.status(400).json({ message: "A valid email is required." });
  const db = await readDb();
  db.passwordResets ||= {};
  const account = [...(db.admins || []), ...(db.teachers || []), ...(db.students || [])].find((item) => String(item.email).toLowerCase() === email);
  if (account) {
    const raw = crypto.randomBytes(32).toString("base64url");
    db.passwordResets[digestToken(raw)] = { userId: account.id, expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString() };
    await writeDb(db);
    if (process.env.NODE_ENV === "test") return res.json({ ok: true, resetToken: raw });
    const frontendBase = String(process.env.FRONTEND_URL || process.env.CLIENT_ORIGIN || "").replace(/\/+$/, "");
    const resetUrl = `${frontendBase}/reset-password?token=${raw}`;
    const delivered = await sendPasswordResetEmail({ to: account.email, name: account.name, resetUrl });
    await recordAudit({ userId: account.id, role: account.role || "unknown", action: delivered ? "auth.password_reset.email_sent" : "auth.password_reset.email_failed", severity: delivered ? "info" : "warning", success: delivered, ip: req.ip, userAgent: req.get("user-agent"), target: account.id });
  }
  // Same response whether or not the account exists (or the email actually
  // sent) - anything else would let an attacker enumerate accounts or probe
  // SMTP health.
  return res.json({ ok: true, message: "If the account exists, password reset instructions have been sent." });
});

authRouter.post("/reset-password", async (req, res) => { const token = String(req.body?.token || ""); const password = req.body?.newPassword; if (token.length < 40 || !validPassword(password)) return res.status(400).json({ message: `A valid reset token and a ${PASSWORD_REQUIREMENTS.toLowerCase()} are required.` }); const db = await readDb(); db.passwordResets ||= {}; const record = db.passwordResets[digestToken(token)]; if (!record || new Date(record.expiresAt) <= new Date()) return res.status(400).json({ message: "Reset token is invalid or expired." }); const account = getAccount(db, { id: record.userId, role: "student" }) || getAccount(db, { id: record.userId, role: "teacher" }) || getAccount(db, { id: record.userId, role: "admin" }); if (!account) { delete db.passwordResets[digestToken(token)]; await writeDb(db); return res.status(400).json({ message: "Reset token is invalid or expired." }); } if (passwordWasUsed(account, password)) return res.status(400).json({ message: "Choose a password that has not been used recently." }); account.passwordHistory = [account.password, ...(account.passwordHistory || [])].filter(Boolean).slice(0, 5); account.password = bcrypt.hashSync(String(password), 12); account.passwordVersion = (account.passwordVersion || 0) + 1; invalidateUserSessions(db, account.id); delete db.passwordResets[digestToken(token)]; await writeDb(db); res.json({ ok: true, message: "Password reset successfully. Please sign in again." }); });

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
    return res.json({ user: { id: teacher.id, name: teacher.name, email: teacher.email, code: teacher.code, department: teacher.department, role: "teacher", isHod: req.user.isHod, hodDepartmentId: req.user.hodDepartmentId, hodDepartment: req.user.hodDepartment } });
  }

  const student = db.students.find((item) => item.id === req.user.id);
  if (!student) return res.status(404).json({ message: "User not found." });
  res.json({ user: { ...publicStudent(student, db.attendance), role: "student" } });
});
