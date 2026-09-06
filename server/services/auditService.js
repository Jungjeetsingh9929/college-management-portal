import crypto from "node:crypto";
import { readDb, writeDb } from "../db/fileStore.js";

const MAX_AUDIT_EVENTS = Math.max(1000, Number(process.env.AUDIT_LOG_MAX_EVENTS) || 10000);
export function appendAudit(db, event = {}) {
  db.auditLogs ||= [];
  db.auditLogs.unshift({ id: crypto.randomUUID(), timestamp: new Date().toISOString(), userId: event.userId || null, role: event.role || null, action: String(event.action || "unknown").slice(0, 120), severity: event.severity || "info", success: event.success !== false, ip: String(event.ip || "unknown").slice(0, 120), userAgent: String(event.userAgent || "unknown").slice(0, 300), target: String(event.target || "").slice(0, 240), previousValue: event.previousValue === undefined ? null : event.previousValue, newValue: event.newValue === undefined ? null : event.newValue });
  if (db.auditLogs.length > MAX_AUDIT_EVENTS) db.auditLogs.length = MAX_AUDIT_EVENTS;
}
export async function recordAudit(event) { const db = await readDb(); appendAudit(db, event); await writeDb(db); }
export function safeAuditValue(value) { if (value === null || value === undefined) return null; if (typeof value !== "object") return String(value).slice(0, 500); const copy = structuredClone(value); for (const key of ["password", "passwordHash", "refreshToken", "token"]) if (key in copy) copy[key] = "[REDACTED]"; return copy; }
