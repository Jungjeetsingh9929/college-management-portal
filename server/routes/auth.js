import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { Router } from "express";
import { makeId, readDb, writeDb } from "../db/fileStore.js";
import { consumeRefreshToken, createRefreshToken, getAccount, requireAuth, revokeRefreshToken, revokeSessionsForUser, signToken } from "../middleware/auth.js";
import { emailInUse } from "../services/accountService.js";
import { publicStudent } from "../services/attendanceService.js";
import { bodyFieldKey, clientKey, rateConfig, rateLimit } from "../middleware/rateLimit.js";
import { PASSWORD_REQUIREMENTS, boundedKey, requiredText, validEmail, validExistingPassword, validPassword, validateKeys } from "../services/validation.js";
import { approvedPhotoId } from "../services/photoService.js";
import { recordAudit } from "../services/auditService.js";
import { sendOtpEmail } from "../services/emailService.js";

export const authRouter = Router();
const loginIpConfig = rateConfig("AUTH_LOGIN_IP", { windowMs: 15 * 60 * 1000, limit: 20, backoffBaseMs: 1000, backoffMaxMs: 60 * 1000 });
const loginAccountConfig = rateConfig("AUTH_LOGIN_ACCOUNT", { windowMs: 15 * 60 * 1000, limit: 8, backoffBaseMs: 2000, backoffMaxMs: 5 * 60 * 1000 });
const signupConfig = rateConfig("AUTH_SIGNUP", { windowMs: 60 * 60 * 1000, limit: 10, backoffBaseMs: 2000, backoffMaxMs: 10 * 60 * 1000 });
// /refresh is unauthenticated and does a database read plus two writes per
// call, and a caller holding one valid token can rotate it indefinitely. It
// was covered only by the 100-per-15-minutes /api/auth limiter shared with
// every other auth route, so refresh traffic could exhaust the budget that
// login and password reset also draw on. Its own bucket keeps the two apart.
const refreshConfig = rateConfig("AUTH_REFRESH", { windowMs: 15 * 60 * 1000, limit: 60, backoffBaseMs: 500, backoffMaxMs: 60 * 1000 });
// Fields accepted from a signup request body. request-otp used to stash the
// entire raw body in db.signupOtps[email].payload, so any extra field a
// caller invented was persisted verbatim for ten minutes (and 100kb of it
// per allowed request). Only these are kept now.
const SIGNUP_FIELDS = ["name", "email", "password", "role", "rollNumber", "className", "department", "phone", "guardian", "graduationYear"];
// db.signupOtps / db.passwordOtps are plain objects keyed by email with no
// eviction: an expired entry was only removed if the same address came back
// and completed the flow. Both are pruned on every write path.
const MAX_PENDING_OTPS = Math.max(100, Number(process.env.MAX_PENDING_OTPS) || 5000);
function pruneOtps(map) {
  if (!map || typeof map !== "object") return;
  const now = new Date().toISOString();
  for (const [key, record] of Object.entries(map)) {
    if (!record || typeof record !== "object" || !record.expiresAt || record.expiresAt <= now) delete map[key];
  }
  const keys = Object.keys(map);
  if (keys.length > MAX_PENDING_OTPS) {
    for (const key of keys.sort((a, b) => String(map[a].expiresAt).localeCompare(String(map[b].expiresAt))).slice(0, keys.length - MAX_PENDING_OTPS)) delete map[key];
  }
}
const digestToken = (value) => crypto.createHash("sha256").update(String(value)).digest("hex");
// Fixed-length hex digests, so a plain length check before timingSafeEqual
// can't itself leak anything - timingSafeEqual throws on mismatched
// lengths, which digestToken/otpDigest never produce here.
function hashesMatch(a, b) {
  const bufA = Buffer.from(String(a || ""), "hex");
  const bufB = Buffer.from(String(b || ""), "hex");
  return bufA.length === bufB.length && bufA.length > 0 && crypto.timingSafeEqual(bufA, bufB);
}
// A precomputed dummy bcrypt hash (of a value nobody will ever type) so a
// login for a nonexistent email still pays the same bcrypt cost as a real
// one, instead of returning early and leaking account existence via timing.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync("no-such-account-timing-guard", 12);
const invalidateUserSessions = (db, userId) => revokeSessionsForUser(db, userId);
function passwordWasUsed(account, password) { return [account.password, ...(account.passwordHistory || [])].some((hash) => hash && bcrypt.compareSync(String(password), hash)); }
function maskedIp(value) { const ip = String(value || ""); if (!ip || ip === "unknown") return null; if (ip.includes(".")) return `${ip.split(".").slice(0, 2).join(".")}.*.*`; return `${ip.split(":").slice(0, 2).join(":")}::/32`; }
function makeOtp() { return String(crypto.randomInt(100000, 1000000)); }
function otpDigest(value) { return digestToken(`otp:${value}`); }
function allAccounts(db) { return [...(db.admins || []), ...(db.students || []), ...(db.teachers || [])]; }
function accountForEmail(db, email) { return allAccounts(db).find((item) => String(item.email || "").toLowerCase() === String(email).trim().toLowerCase()); }
// Shared by /login, /refresh, and /me so all three ever compute the same
// "safe user" shape, straight from the database, the same way. isHod in
// particular has to be looked up fresh every time (never trusted from a
// stale caller-supplied value) - it's what lets a promotion/demotion an
// admin makes show up on the next refresh instead of only after the next
// full login.
function buildSafeUser(db, account, role) {
  if (role === "student") return { ...publicStudent(account, db.attendance), role, approvedPhotoId: approvedPhotoId(db, account.id) };
  if (role === "teacher") {
    const hodDepartment = (db.departments || []).find((item) => item.hodId === account.id);
    return { id: account.id, name: account.name, email: account.email, code: account.code, department: account.department, role, isHod: Boolean(hodDepartment), hodDepartmentId: hodDepartment?.id || null, hodDepartment: hodDepartment?.name || null };
  }
  return { id: account.id, name: account.name, email: account.email, role };
}

authRouter.post("/login", rateLimit({
  ...loginIpConfig,
  message: "Too many login attempts for this account. Please try again later.",
  keyGenerator: clientKey
}), rateLimit({
  ...loginAccountConfig,
  // Bounded + canonicalised: the raw field could be most of the request
  // body, and one bucket per spelling of the same address would defeat the
  // per-account limit (see bodyFieldKey).
  keyGenerator: bodyFieldKey("email"),
  message: "Too many login attempts for this account. Please try again later."
}), async (req, res) => {
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
    return res.status(400).json({ message: "Invalid login request." });
  }
  try { validateKeys(req.body, ["email", "password", "role"]); } catch { return res.status(400).json({ message: "Invalid login request." }); }
  const { email, password, role } = req.body;
  // validExistingPassword, not validPassword: see the note on that helper.
  // An account whose stored hash predates the current policy must still be
  // able to sign in - otherwise it can never reach change-password either.
  if (!validEmail(email) || !validExistingPassword(password) || !["admin", "teacher", "student"].includes(role)) {
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
  const safeUser = buildSafeUser(db, user, userRole);

  await recordAudit({ userId: user.id, role: userRole, action: "auth.login.success", severity: "info", ip: req.ip, userAgent: req.get("user-agent"), target: user.id });
  // Tells the client this account signed in with a password that no longer
  // meets the policy, so it can prompt for a change. Nothing is blocked on
  // it; the account is usable either way.
  res.json({ token, refreshToken: session.token, sessionId: session.sessionId, expiresIn: process.env.ACCESS_TOKEN_TTL || "15m", user: safeUser, passwordPolicyStale: !validPassword(password) });
});

authRouter.post("/refresh", rateLimit({ ...refreshConfig, keyGenerator: clientKey, scope: "api:auth-refresh", message: "Too many token refresh requests. Please try again later." }), async (req, res) => {
  try { validateKeys(req.body || {}, ["refreshToken"]); } catch { return res.status(401).json({ message: "Refresh token is required." }); }
  const raw = req.body?.refreshToken; if (typeof raw !== "string" || raw.length < 40) return res.status(401).json({ message: "Refresh token is required." });
  const db = await readDb(); const stored = await consumeRefreshToken(raw, db); if (!stored) return res.status(401).json({ message: "Refresh token is invalid or expired." });
  const account = getAccount(db, { id: stored.userId, role: stored.role }); if (!account || account.active === false || (account.passwordVersion || 0) !== (stored.passwordVersion || 0)) return res.status(401).json({ message: "Refresh token is no longer valid." });
  const user = { ...account, role: stored.role }; const session = await createRefreshToken(user, db, { device: stored.device || req.headers["user-agent"], ip: req.ip, userAgent: req.get("user-agent") });
  // Carry the original sign-in time forward across rotations, otherwise the
  // "active sessions" list showed every session as having started seconds
  // ago (the access token refreshes every 15 minutes).
  const rotated = Object.values(db.refreshTokens).find((item) => item.sessionId === session.sessionId);
  if (rotated) { rotated.createdAt = stored.createdAt || rotated.createdAt; rotated.lastActiveAt = new Date().toISOString(); await writeDb(db); }
  const token = signToken({ ...user, sessionId: session.sessionId });
  // Also returning `user` here (same shape as /login) is what lets the
  // client refresh role metadata like isHod on every silent background
  // token refresh, instead of only on a full page load - see AuthContext.jsx.
  const safeUser = buildSafeUser(db, account, stored.role);
  res.json({ token, refreshToken: session.token, sessionId: session.sessionId, expiresIn: process.env.ACCESS_TOKEN_TTL || "15m", user: safeUser });
});

authRouter.post("/logout", async (req, res) => { try { validateKeys(req.body || {}, ["refreshToken"]); } catch { return res.status(400).json({ message: "Invalid logout request." }); } if (typeof req.body?.refreshToken === "string" && req.body.refreshToken.length <= 500) { const db = await readDb(); await revokeRefreshToken(req.body.refreshToken, db); } res.json({ ok: true }); });

authRouter.get("/sessions", requireAuth, async (req, res) => { const db = await readDb(); const now = new Date(); const sessions = Object.values(db.refreshTokens || {}).filter((item) => item.userId === req.user.id && !item.revokedAt && new Date(item.expiresAt) > now).map((item) => ({ sessionId: item.sessionId, device: item.device || "Unknown device", userAgent: item.userAgent || "Unknown browser", ip: maskedIp(item.ip), createdAt: item.createdAt, lastActiveAt: item.lastActiveAt || item.createdAt, expiresAt: item.expiresAt, current: item.sessionId === req.user.sessionId })); res.json({ sessions }); });
authRouter.post("/sessions/:sessionId/revoke", requireAuth, async (req, res) => { const db = await readDb(); const session = Object.values(db.refreshTokens || {}).find((item) => item.sessionId === req.params.sessionId && item.userId === req.user.id && !item.revokedAt); if (!session) return res.status(404).json({ message: "Session not found." }); session.revokedAt = new Date().toISOString(); await writeDb(db); res.json({ ok: true, current: session.sessionId === req.user.sessionId }); });
authRouter.post("/sessions/logout-others", requireAuth, async (req, res) => { const db = await readDb(); let revoked = 0; Object.values(db.refreshTokens || {}).forEach((session) => { if (session.userId === req.user.id && session.sessionId !== req.user.sessionId && !session.revokedAt) { session.revokedAt = new Date().toISOString(); revoked += 1; } }); await writeDb(db); res.json({ ok: true, revoked }); });

authRouter.post("/signup/request-otp", rateLimit({ ...signupConfig, message: "Too many signup requests. Please try again later." }), async (req, res) => {
  try { validateKeys(req.body || {}, SIGNUP_FIELDS); } catch { return res.status(400).json({ message: "Invalid signup request." }); }
  const requestedRole = req.body?.role === "faculty" ? "faculty" : req.body?.role === "student" ? "student" : "";
  const email = boundedKey(req.body?.email, 254);
  const password = req.body?.password;
  if (!requestedRole || !validEmail(email) || !validPassword(password)) return res.status(400).json({ message: `Name, email, role, and a ${PASSWORD_REQUIREMENTS.toLowerCase()} are required.` });
  const db = await readDb();
  if (accountForEmail(db, email) || (db.pendingAccessRequests || []).some((item) => String(item.email || "").toLowerCase() === email && item.status === "pending") || (db.pendingStudents || []).some((item) => String(item.email || "").toLowerCase() === email && item.approvalStatus === "pending")) return res.status(409).json({ message: "This email already has an account or pending request." });
  const otp = makeOtp();
  db.signupOtps ||= {};
  pruneOtps(db.signupOtps);
  const payload = { email, password: bcrypt.hashSync(String(password), 12) };
  for (const field of SIGNUP_FIELDS) {
    if (["email", "password", "role"].includes(field)) continue;
    if (req.body[field] !== undefined) payload[field] = String(req.body[field]).slice(0, 200);
  }
  db.signupOtps[email] = { email, requestedRole, payload, otpHash: otpDigest(otp), attempts: 0, expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString() };
  await writeDb(db);
  await sendOtpEmail({ to: email, name: req.body?.name, otp, purpose: "signup" });
  res.json({ ok: true, message: "A verification code was sent to your email. It expires in 10 minutes." });
});

authRouter.post("/signup/verify-otp", rateLimit({ ...signupConfig, message: "Too many verification attempts. Please try again later." }), async (req, res) => {
  try { validateKeys(req.body || {}, ["email", "otp"]); } catch { return res.status(400).json({ message: "A valid email and six-digit code are required." }); }
  const email = boundedKey(req.body?.email, 254);
  const otp = String(req.body?.otp || "").trim();
  if (!validEmail(email) || !/^\d{6}$/.test(otp)) return res.status(400).json({ message: "A valid email and six-digit code are required." });
  const db = await readDb(); db.signupOtps ||= {}; pruneOtps(db.signupOtps);
  const record = db.signupOtps[email];
  if (!record || record.expiresAt <= new Date().toISOString() || record.attempts >= 5 || !hashesMatch(record.otpHash, otpDigest(otp))) {
    if (record) { record.attempts = (record.attempts || 0) + 1; await writeDb(db); }
    return res.status(400).json({ message: "That verification code is invalid or expired." });
  }
  db.pendingAccessRequests ||= [];
  // The uniqueness check at request-otp time is ~10 minutes stale by now, so
  // two people could each hold a valid code for the same address. Re-check
  // before turning the code into a pending request.
  if (accountForEmail(db, email)) { delete db.signupOtps[email]; await writeDb(db); return res.status(409).json({ message: "This email already has an account." }); }
  const payload = record.payload;
  // A missing/blank name threw out of requiredText here and surfaced as a
  // 500 from the global handler, after the OTP had already been accepted.
  // request-otp never validated the name, so this was reachable.
  let verifiedName;
  try { verifiedName = requiredText(payload.name, "Name", { max: 120 }); }
  catch { delete db.signupOtps[email]; await writeDb(db); return res.status(400).json({ message: "The name on this signup request is invalid. Please start the signup again." }); }
  db.pendingAccessRequests.unshift({ id: makeId("access"), name: verifiedName, requestedRole: record.requestedRole, email, password: payload.password, rollNumber: String(payload.rollNumber || "").slice(0, 40), className: String(payload.className || "").slice(0, 80), department: String(payload.department || "").slice(0, 100), phone: String(payload.phone || "").slice(0, 30), guardian: String(payload.guardian || "").slice(0, 120), graduationYear: String(payload.graduationYear || "").slice(0, 10), emailVerified: true, status: "pending", createdAt: new Date().toISOString() });
  delete db.signupOtps[email]; await writeDb(db);
  res.status(201).json({ ok: true, message: "Email verified. Your access request is now waiting for admin approval." });
});

authRouter.post("/request-password-otp", rateLimit({ ...signupConfig, message: "Too many password reset requests. Please try again later." }), async (req, res) => {
  try { validateKeys(req.body || {}, ["email"]); } catch { return res.status(400).json({ message: "If the account exists, a verification code has been sent." }); }
  const email = boundedKey(req.body?.email, 254);
  if (!validEmail(email)) return res.status(400).json({ message: "If the account exists, a verification code has been sent." });
  const db = await readDb(); const account = accountForEmail(db, email);
  if (account) {
    const otp = makeOtp(); db.passwordOtps ||= {}; pruneOtps(db.passwordOtps);
    db.passwordOtps[email] = { userId: account.id, otpHash: otpDigest(otp), attempts: 0, expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString() };
    await writeDb(db); await sendOtpEmail({ to: email, name: account.name, otp, purpose: "password" });
  }
  res.json({ ok: true, message: "If the account exists, a verification code has been sent." });
});

authRouter.post("/reset-password-otp", rateLimit({ ...signupConfig, message: "Too many password reset attempts. Please try again later." }), async (req, res) => {
  try { validateKeys(req.body || {}, ["email", "otp", "newPassword"]); } catch { return res.status(400).json({ message: "Invalid password reset request." }); }
  const email = boundedKey(req.body?.email, 254); const otp = String(req.body?.otp || "").trim(); const newPassword = req.body?.newPassword;
  if (!validEmail(email) || !/^\d{6}$/.test(otp) || !validPassword(newPassword)) return res.status(400).json({ message: `A valid email, six-digit code, and a ${PASSWORD_REQUIREMENTS.toLowerCase()} are required.` });
  const db = await readDb(); db.passwordOtps ||= {}; const record = db.passwordOtps[email]; pruneOtps(db.passwordOtps);
  if (!record || record.expiresAt <= new Date().toISOString() || record.attempts >= 5 || !hashesMatch(record.otpHash, otpDigest(otp))) { if (record) { record.attempts = (record.attempts || 0) + 1; await writeDb(db); } return res.status(400).json({ message: "That verification code is invalid or expired." }); }
  const account = getAccount(db, { id: record.userId, role: "student" }) || getAccount(db, { id: record.userId, role: "teacher" }) || getAccount(db, { id: record.userId, role: "admin" });
  if (!account || passwordWasUsed(account, newPassword)) return res.status(400).json({ message: "Choose a password that has not been used recently." });
  account.passwordHistory = [account.password, ...(account.passwordHistory || [])].filter(Boolean).slice(0, 5); account.password = bcrypt.hashSync(String(newPassword), 12); account.passwordVersion = (account.passwordVersion || 0) + 1; invalidateUserSessions(db, account.id); delete db.passwordOtps[email]; await writeDb(db);
  res.json({ ok: true, message: "Password reset successfully. Please sign in again." });
});

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

  // Was checked against db.students only, so an email already used by a
  // teacher or admin account sailed through and produced two accounts
  // sharing a login address.
  const pendingExists = db.pendingStudents.some((student) => String(student.email || "").toLowerCase() === email && student.approvalStatus === "pending")
    || (db.pendingAccessRequests || []).some((item) => String(item.email || "").toLowerCase() === email && item.status === "pending");
  if (emailInUse(db, email) || pendingExists) {
    return res.status(409).json({ message: "This email already has an account or pending request." });
  }
  if ((db.students || []).some((student) => String(student.rollNumber || "").trim().toLowerCase() === rollNumber.toLowerCase())) {
    return res.status(409).json({ message: "This roll number is already registered." });
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
  // currentPassword is only bounded here (bcrypt below is the real check),
  // so an account still on a pre-policy password can rotate off it. The new
  // password is held to the full policy.
  if (!validExistingPassword(currentPassword) || !validPassword(newPassword)) {
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
    return res.json({ user: buildSafeUser(db, admin, "admin") });
  }

  if (req.user.role === "teacher") {
    const teacher = (db.teachers || []).find((item) => item.id === req.user.id);
    if (!teacher) return res.status(404).json({ message: "User not found." });
    return res.json({ user: buildSafeUser(db, teacher, "teacher") });
  }

  const student = db.students.find((item) => item.id === req.user.id);
  if (!student) return res.status(404).json({ message: "User not found." });
  res.json({ user: buildSafeUser(db, student, "student") });
});
