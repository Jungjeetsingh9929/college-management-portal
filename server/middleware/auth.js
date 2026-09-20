import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { readDb, writeDb } from "../db/fileStore.js";

const secret = process.env.JWT_SECRET; const ACCESS_TOKEN_TTL = process.env.ACCESS_TOKEN_TTL || "15m"; const REFRESH_TOKEN_DAYS = Math.max(1, Number(process.env.REFRESH_TOKEN_DAYS) || 30);
if (!secret || secret === "replace-with-a-long-random-secret" || secret.length < 32) throw new Error("JWT_SECRET must be set to a random value of at least 32 characters.");
export function signToken(user) { return jwt.sign({ id: user.id, role: user.role || "student", name: user.name, email: user.email, code: user.code, className: user.className, passwordVersion: user.passwordVersion || 0, sessionId: user.sessionId || null, tokenType: "access" }, secret, { expiresIn: ACCESS_TOKEN_TTL, issuer: "college-portal", audience: "college-portal-client", algorithm: "HS256" }); }
function digest(value) { return crypto.createHash("sha256").update(String(value)).digest("hex"); }
export async function createRefreshToken(user, db, metadata = {}) { db.refreshTokens ||= {}; const raw = crypto.randomBytes(48).toString("base64url"); const sessionId = crypto.randomUUID(); const now = new Date().toISOString(); db.refreshTokens[digest(raw)] = { sessionId, userId: user.id, role: user.role, passwordVersion: user.passwordVersion || 0, device: String(metadata.device || "Unknown device").slice(0, 120), ip: String(metadata.ip || "unknown").slice(0, 120), userAgent: String(metadata.userAgent || "unknown").slice(0, 300), createdAt: now, lastActiveAt: now, expiresAt: new Date(Date.now() + REFRESH_TOKEN_DAYS * 86400000).toISOString() }; await writeDb(db); return { token: raw, sessionId }; }
// Revokes every live refresh token belonging to a user. Bumping
// passwordVersion only invalidates *access* tokens (requireAuth compares it);
// the refresh tokens kept working and would mint brand new access tokens, so
// "change password" / "deactivate account" / "delete account" did not
// actually end the attacker's session. Callers must still writeDb(db).
export function revokeSessionsForUser(db, userId, { exceptSessionId = null } = {}) {
  let revoked = 0;
  const now = new Date().toISOString();
  for (const session of Object.values(db.refreshTokens || {})) {
    if (session.userId !== userId || session.revokedAt) continue;
    if (exceptSessionId && session.sessionId === exceptSessionId) continue;
    session.revokedAt = now;
    revoked += 1;
  }
  return revoked;
}
// Refresh tokens rotate: each use is marked revoked and a new one issued. If
// an already-revoked (but unexpired) token is presented again, either it was
// stolen and replayed or the legitimate client raced itself. Previously this
// just returned null and the *stolen* chain kept working. Now a replay
// revokes every session for that user, forcing a fresh login.
export async function consumeRefreshToken(raw, db) {
  db.refreshTokens ||= {};
  const key = digest(raw);
  const stored = db.refreshTokens[key];
  if (!stored) return null;
  const expired = new Date(stored.expiresAt) <= new Date();
  if (stored.revokedAt && !expired) {
    stored.reusedAt = new Date().toISOString();
    revokeSessionsForUser(db, stored.userId);
    await writeDb(db);
    return null;
  }
  if (stored.revokedAt || expired) return null;
  stored.revokedAt = new Date().toISOString();
  await writeDb(db);
  return stored;
}
export async function revokeRefreshToken(raw, db) { db.refreshTokens ||= {}; const stored = db.refreshTokens[digest(raw)]; if (stored) { stored.revokedAt = new Date().toISOString(); await writeDb(db); } }
export function getAccount(db, user) { const collection = user.role === "admin" ? db.admins || [] : user.role === "teacher" ? db.teachers || [] : db.students || []; return collection.find((item) => item.id === user.id); }
export async function requireAuth(req, res, next) { const header = req.headers.authorization || ""; const token = header.startsWith("Bearer ") ? header.slice(7) : null; if (!token) return res.status(401).json({ message: "Authentication token is required." }); try { const payload = jwt.verify(token, secret, { issuer: "college-portal", audience: "college-portal-client", algorithms: ["HS256"] }); if (payload.tokenType !== "access") return res.status(401).json({ message: "Invalid access token." }); const db = await readDb(); const account = getAccount(db, payload); if (!account || account.active === false || (account.passwordVersion || 0) !== (payload.passwordVersion || 0)) return res.status(401).json({ message: "Your session has expired. Please sign in again." }); const department = payload.role === "teacher" ? (db.departments || []).find((item) => item.hodId === payload.id) : null; req.user = { ...payload, isHod: Boolean(department), hodDepartmentId: department?.id || null, hodDepartment: department?.name || null }; next(); } catch { res.status(401).json({ message: "Invalid or expired token." }); } }
export function requireAdmin(req, res, next) { if (req.user?.role !== "admin") return res.status(403).json({ message: "Admin access is required." }); next(); }
export function requireFaculty(req, res, next) { if (req.user?.role !== "teacher") return res.status(403).json({ message: "Teacher access is required." }); next(); }
export function requireStaff(req, res, next) { if (!["admin", "teacher"].includes(req.user?.role)) return res.status(403).json({ message: "Staff access is required." }); next(); }
export function requireHod(req, res, next) { if (req.user?.role !== "teacher" || !req.user?.isHod) return res.status(403).json({ message: "Head of Department access is required." }); next(); }
