import { Router } from "express";
import crypto from "node:crypto";
import { readDb, writeDb, makeId } from "../db/fileStore.js";
import { requireAuth, requireStaff } from "../middleware/auth.js";
import { clientKey, rateConfig, rateLimit } from "../middleware/rateLimit.js";
import { calculateStudentStats, enrichAttendance, subjectStats, today, upsertAttendance, ATTENDANCE_STATUSES, createQrToken, attendanceAnalytics, attendanceCsv } from "../services/attendanceService.js";
import { classesTaughtByTeacher, studentIdsVisibleToTeacher } from "../services/accessService.js";
import { isWithinCollege } from "../utils/geo.js";
import { resolveClientOrigin } from "../config/clientOrigin.js";
import { sendAttendanceReminderEmail } from "../services/emailService.js";

export const attendanceRouter = Router();
function parseDateParam(value) { if (value === undefined || value === null || value === "") return { date: null, valid: true }; if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(new Date(value).getTime())) return { date: null, valid: false }; return { date: value, valid: true }; }
function canAccessSubject(db, req, subject) { return req.user.role === "admin" || (req.user.role === "teacher" && classesTaughtByTeacher(db, req.user.code).includes(subject?.className)); }
function timeInWindow(session) { const now = Date.now(); return now >= new Date(session.startsAt).getTime() && now <= new Date(session.endsAt).getTime(); }
// Client-supplied strings are used directly as object keys on db.* maps
// (attendanceNonces, attendanceBatches). Unconstrained, that allowed two
// problems: a key of "__proto__"/"constructor"/"toString" either mutated the
// prototype chain or matched an inherited property, so `if (db.map[key])`
// returned true for a key nobody ever stored - letting a client fake an
// already-used nonce or replay an attendance batch that never ran. It also
// let a caller write unbounded garbage into the database. Restrict to a
// plain opaque token and look keys up as own properties only.
// Note the charset alone is not enough: "__proto__" and "constructor" are
// made entirely of allowed characters, and assigning to db.map["__proto__"]
// mutates the prototype instead of creating an own property - so the replay
// check would never see it again. Reject those names outright, and always
// probe with hasOwnProperty so an inherited member ("toString") can't be
// mistaken for a stored entry.
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const SAFE_KEY_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
function isSafeKey(value) { return typeof value === "string" && SAFE_KEY_PATTERN.test(value) && !UNSAFE_KEYS.has(value); }
function hasKey(map, key) { return Object.prototype.hasOwnProperty.call(map || {}, key); }

// The check-in route as an origin-less path: a protected client route
// (/attend/:sessionId) carrying the current rotating QR token as `?t=`.
//
// This is the field the UI actually encodes into the QR image. The browser
// resolves it against window.location.origin - i.e. the origin the teacher
// is demonstrably able to reach, on the same deployment students use - so
// the scannable link is correct by construction and cannot inherit a stale
// or mistyped CLIENT_ORIGIN. See client/src/pages/AttendanceCommandCenter.jsx.
function qrCheckInPath(session) {
  return `/attend/${session.id}?t=${encodeURIComponent(session.qrToken)}`;
}

// Absolute form, kept for consumers that have no browser origin to resolve
// against: non-browser API clients, and the reminder email below.
// CLIENT_ORIGIN/FRONTEND_URL is validated at startup
// (server/config/clientOrigin.js), so by the time this runs in production
// the configured origin has already been checked for being present,
// parseable and non-loopback.
function qrCheckInUrl(req, session) {
  const { origin, source } = resolveClientOrigin(req);
  return { url: `${origin}${qrCheckInPath(session)}`, origin, source };
}

// Everything the client needs to render and share a session's QR.
function withQr(req, session) {
  const absolute = qrCheckInUrl(req, session);
  return { ...session, qrPath: qrCheckInPath(session), qr: absolute.url, qrOrigin: absolute.origin, qrOriginSource: absolute.source };
}

attendanceRouter.get("/", requireAuth, async (req, res) => { const db = await readDb(); let records = db.attendance || []; if (req.user.role === "teacher") { const visible = studentIdsVisibleToTeacher(db, req.user.code); records = records.filter((item) => visible.has(item.studentId)); } if (req.query.studentId) records = records.filter((item) => item.studentId === req.query.studentId); if (req.query.subjectId) records = records.filter((item) => item.subjectId === req.query.subjectId); if (req.query.date) records = records.filter((item) => item.date === req.query.date); if (req.user.role === "student") records = records.filter((item) => item.studentId === req.user.id); res.json({ attendance: enrichAttendance(records, db) }); });
attendanceRouter.get("/summary", requireAuth, async (req, res) => { const db = await readDb(); const visible = req.user.role === "teacher" ? studentIdsVisibleToTeacher(db, req.user.code) : null; const studentId = req.user.role === "student" ? req.user.id : req.query.studentId; if (req.user.role === "teacher" && studentId && !visible.has(studentId)) return res.status(403).json({ message: "You can only view attendance for students in your classes." }); if (studentId) return res.json({ stats: calculateStudentStats(studentId, db.attendance || []), subjects: subjectStats(studentId, db.subjects, db.attendance || []), today: enrichAttendance((db.attendance || []).filter((i) => i.studentId === studentId && i.date === today()), db) }); const scoped = req.user.role === "teacher" ? (db.attendance || []).filter((i) => visible.has(i.studentId)) : (db.attendance || []); const present = scoped.filter((i) => ["present", "late"].includes(i.status)).length; res.json({ stats: { students: req.user.role === "teacher" ? visible.size : db.students.length, subjects: db.subjects.length, present, absent: scoped.filter((i) => i.status === "absent").length, percentage: scoped.length ? Math.round((present / scoped.length) * 100) : 0 }, today: enrichAttendance(scoped.filter((i) => i.date === today()), db) }); });

attendanceRouter.get("/roster", requireAuth, requireStaff, async (req, res) => { const { subjectId } = req.query; if (!subjectId) return res.status(400).json({ message: "subjectId is required." }); const parsed = parseDateParam(req.query.date); if (!parsed.valid) return res.status(400).json({ message: "date must be a valid date in YYYY-MM-DD format." }); const db = await readDb(); const subject = db.subjects.find((i) => i.id === subjectId); if (!subject) return res.status(404).json({ message: "Subject not found." }); if (!canAccessSubject(db, req, subject)) return res.status(403).json({ message: "You can only mark attendance for classes you teach." }); const date = parsed.date || today(); const roster = db.students.filter((s) => s.className === subject.className).map((student) => { const existing = db.attendance.find((i) => i.studentId === student.id && i.subjectId === subject.id && i.date === date); return { studentId: student.id, name: student.name, rollNumber: student.rollNumber, status: existing?.status || null, time: existing?.time || null, method: existing?.method || null, riskLevel: existing?.riskLevel || "low" }; }); res.json({ subject: { id: subject.id, subjectName: subject.subjectName, code: subject.code, className: subject.className }, date, roster }); });

attendanceRouter.post("/mark", requireAuth, requireStaff, rateLimit({ ...rateConfig("ATTENDANCE_MARK", { windowMs: 60000, limit: 100 }), message: "Too many attendance updates.", keyGenerator: (req) => req.user?.id || clientKey(req) }), async (req, res) => { const { studentId, subjectId, status, date, reason } = req.body || {}; if (!studentId || !subjectId || !ATTENDANCE_STATUSES.includes(status)) return res.status(400).json({ message: `studentId, subjectId, and a status of ${ATTENDANCE_STATUSES.join(", ")} are required.` }); const parsed = parseDateParam(date); if (!parsed.valid) return res.status(400).json({ message: "date must be a valid date in YYYY-MM-DD format." }); const db = await readDb(); const student = db.students.find((i) => i.id === studentId); const subject = db.subjects.find((i) => i.id === subjectId); if (!student || !subject) return res.status(404).json({ message: "Student or subject not found." }); if (student.className !== subject.className) return res.status(400).json({ message: "This student is not enrolled in this subject's class." }); if (!canAccessSubject(db, req, subject)) return res.status(403).json({ message: "You can only mark attendance for classes you teach." }); const result = upsertAttendance(db, { studentId, subjectId, status, date: parsed.date, method: "manual", changedBy: req.user.id, reason }); await writeDb(db); res.json({ record: enrichAttendance([result.record], db)[0], duplicatePrevented: result.duplicatePrevented }); });

attendanceRouter.post("/batch", requireAuth, requireStaff, async (req, res) => { const { subjectId, date, records, idempotencyKey } = req.body || {}; if (!subjectId || !Array.isArray(records) || !records.length || !isSafeKey(idempotencyKey)) return res.status(400).json({ message: "subjectId, records, and an alphanumeric idempotencyKey (up to 128 chars) are required." });
  if (records.length > 500) return res.status(413).json({ message: "A batch can contain at most 500 records." }); const parsed = parseDateParam(date); if (!parsed.valid) return res.status(400).json({ message: "date must be valid YYYY-MM-DD." }); const db = await readDb(); db.attendanceBatches ||= {}; if (hasKey(db.attendanceBatches, idempotencyKey)) return res.json({ ...db.attendanceBatches[idempotencyKey], replayed: true }); const subject = db.subjects.find((i) => i.id === subjectId); if (!subject || !canAccessSubject(db, req, subject)) return res.status(403).json({ message: "You cannot mark this subject." }); const results = records.map((item) => { const student = db.students.find((s) => s.id === item.studentId); if (!student || student.className !== subject.className || !ATTENDANCE_STATUSES.includes(item.status)) return { studentId: item.studentId, error: "Invalid student or status" }; return upsertAttendance(db, { studentId: student.id, subjectId, status: item.status, date: parsed.date, method: "bulk", changedBy: req.user.id }); }); const response = { batchId: makeId("batch"), processed: results.filter((i) => !i.error).length, rejected: results.filter((i) => i.error).length, records: results.map((i) => i.record ? enrichAttendance([i.record], db)[0] : i) }; db.attendanceBatches[idempotencyKey] = response; await writeDb(db); res.status(201).json(response); });

attendanceRouter.post("/sessions", requireAuth, requireStaff, async (req, res) => {
  const { subjectId, durationMinutes = 15, startsAt = new Date().toISOString(), lateAfterMinutes = 5 } = req.body || {};
  // `new Date("banana").toISOString()` throws a RangeError, which escaped as
  // an unhandled 500. A non-numeric durationMinutes produced NaN and blew up
  // the same way on endsAt. Both are client-controlled, so validate first.
  const starts = new Date(startsAt);
  if (Number.isNaN(starts.getTime())) return res.status(400).json({ message: "startsAt must be a valid date." });
  const duration = Number(durationMinutes);
  if (!Number.isFinite(duration) || duration < 1 || duration > 24 * 60) return res.status(400).json({ message: "durationMinutes must be between 1 and 1440." });
  const lateAfter = Number(lateAfterMinutes);
  if (!Number.isFinite(lateAfter) || lateAfter < 0 || lateAfter > duration) return res.status(400).json({ message: "lateAfterMinutes must be between 0 and the session duration." });
  const db = await readDb();
  const subject = db.subjects.find((i) => i.id === subjectId);
  if (!subject || !canAccessSubject(db, req, subject)) return res.status(403).json({ message: "You cannot create a session for this subject." });
  const session = { id: makeId("session"), subjectId, createdBy: req.user.id, startsAt: starts.toISOString(), endsAt: new Date(starts.getTime() + duration * 60000).toISOString(), lateAfterMinutes: lateAfter, sequence: 0, qrToken: "", active: true, createdAt: new Date().toISOString() };
  session.qrToken = createQrToken(session.id, session.sequence);
  db.attendanceSessions ||= [];
  db.attendanceSessions.unshift(session);
  await writeDb(db);
  res.status(201).json({ session: withQr(req, session) });
});
attendanceRouter.get("/sessions", requireAuth, requireStaff, async (req, res) => { const db = await readDb(); const sessions = (db.attendanceSessions || []).filter((s) => req.user.role === "admin" || s.createdBy === req.user.id).map((s) => withQr(req, s)); res.json({ sessions }); });
attendanceRouter.post("/sessions/:id/rotate", requireAuth, requireStaff, async (req, res) => { const db = await readDb(); const session = (db.attendanceSessions || []).find((i) => i.id === req.params.id); if (!session || (req.user.role !== "admin" && session.createdBy !== req.user.id)) return res.status(404).json({ message: "Session not found." }); session.sequence++; session.qrToken = createQrToken(session.id, session.sequence); await writeDb(db); res.json({ session: withQr(req, session) }); });
// Email the check-in link to everyone in the class who hasn't checked in yet.
//
// The in-app bell notification (buildNotifications() in routes/shared.js)
// only reaches a student who already has the portal open; this is the push
// equivalent, and mirrors the fee reminder flow in routes/fees.js - same
// record-then-send shape, same graceful degradation when SMTP is unset.
//
// Rate-limited per session rather than per user: rotating the QR is a normal
// thing to do mid-class and must not become a way to mail the class twice a
// minute.
attendanceRouter.post("/sessions/:id/remind", requireAuth, requireStaff, rateLimit({ ...rateConfig("ATTENDANCE_REMIND", { windowMs: 300000, limit: 3 }), message: "Too many attendance reminders for this session. Wait a few minutes before sending another.", keyGenerator: (req) => `${req.user?.id || clientKey(req)}:${req.params.id}` }), async (req, res) => {
  const db = await readDb();
  const session = (db.attendanceSessions || []).find((i) => i.id === req.params.id);
  if (!session || (req.user.role !== "admin" && session.createdBy !== req.user.id)) return res.status(404).json({ message: "Session not found." });
  if (!session.active || !timeInWindow(session)) return res.status(409).json({ message: "This attendance session is not currently open, so there is nothing for students to check in to." });
  const subject = db.subjects.find((i) => i.id === session.subjectId);
  if (!subject) return res.status(404).json({ message: "Subject not found." });

  // Skip anyone already marked for this session - a "you haven't checked in"
  // email to a student who has is worse than no email at all.
  const alreadyMarked = new Set((db.attendance || []).filter((i) => i.sessionId === session.id).map((i) => i.studentId));
  const recipients = db.students.filter((s) => s.className === subject.className && !alreadyMarked.has(s.id) && s.email);

  // Absolute URL, from the validated configured origin - never from the
  // request body. See sendAttendanceReminderEmail().
  const { url: checkInUrl, source: originSource } = qrCheckInUrl(req, session);
  const closesAt = new Date(session.endsAt).toISOString();

  const results = await Promise.all(recipients.map(async (student) => ({
    studentId: student.id,
    sent: await sendAttendanceReminderEmail({ to: student.email, name: student.name, subjectName: subject.subjectName, className: subject.className, checkInUrl, closesAt })
  })));

  const delivered = results.filter((i) => i.sent).length;
  const record = { id: makeId("remind"), sessionId: session.id, subjectId: subject.id, sequence: session.sequence, sentBy: req.user.id, sentAt: new Date().toISOString(), recipients: recipients.length, delivered, skipped: alreadyMarked.size, delivery: delivered ? (delivered === recipients.length ? "email-sent" : "email-partial") : "recorded-no-email", originSource };
  db.attendanceReminders ||= [];
  db.attendanceReminders.unshift(record);
  await writeDb(db);

  res.status(201).json({ reminder: record, message: !recipients.length ? "Everyone in this class has already checked in - no reminders sent." : delivered ? `Reminder emailed to ${delivered} student${delivered === 1 ? "" : "s"} who haven't checked in yet.` : "Reminder recorded; SMTP email was not available." });
});
attendanceRouter.get("/sessions/:id/reminders", requireAuth, requireStaff, async (req, res) => { const db = await readDb(); const session = (db.attendanceSessions || []).find((i) => i.id === req.params.id); if (!session || (req.user.role !== "admin" && session.createdBy !== req.user.id)) return res.status(404).json({ message: "Session not found." }); res.json({ reminders: (db.attendanceReminders || []).filter((i) => i.sessionId === session.id) }); });
attendanceRouter.post("/check-in", requireAuth, async (req, res) => { if (req.user.role !== "student") return res.status(403).json({ message: "Only students can check in." }); const { sessionId, qrToken, latitude, longitude, accuracy, deviceFingerprint, nonce } = req.body || {}; if (!sessionId || typeof qrToken !== "string" || !isSafeKey(nonce)) return res.status(400).json({ message: "sessionId, qrToken, and an alphanumeric nonce (up to 128 chars) are required." });
  if (deviceFingerprint !== undefined && (typeof deviceFingerprint !== "string" || deviceFingerprint.length > 256)) return res.status(400).json({ message: "deviceFingerprint is invalid." }); const db = await readDb(); db.attendanceNonces ||= {}; const session = (db.attendanceSessions || []).find((i) => i.id === sessionId); if (!session || !session.active || session.qrToken !== qrToken) return res.status(409).json({ message: "QR code expired or invalid." }); if (hasKey(db.attendanceNonces, nonce)) return res.status(409).json({ message: "This check-in has already been used." }); if (!timeInWindow(session)) return res.status(409).json({ message: "This attendance session is outside its time window." }); const subject = db.subjects.find((i) => i.id === session.subjectId); const student = db.students.find((i) => i.id === req.user.id); if (!student || student.className !== subject?.className) return res.status(403).json({ message: "You are not enrolled in this class." }); let location = null; let locationVerified = false; try { location = isWithinCollege(Number(latitude), Number(longitude), accuracy); locationVerified = location.withinRange; } catch { locationVerified = false; } if (!locationVerified) return res.status(403).json({ message: "Location verification failed. Please enable campus geolocation." }); const riskLevel = deviceFingerprint && db.deviceFingerprints?.[req.user.id] && db.deviceFingerprints[req.user.id] !== deviceFingerprint ? "high" : Number(accuracy) > 100 ? "medium" : "low"; db.deviceFingerprints ||= {}; db.deviceFingerprints[req.user.id] = deviceFingerprint || db.deviceFingerprints[req.user.id] || null; db.attendanceNonces[nonce] = { studentId: req.user.id, sessionId, usedAt: new Date().toISOString() }; const late = Date.now() > new Date(session.startsAt).getTime() + session.lateAfterMinutes * 60000; const result = upsertAttendance(db, { studentId: req.user.id, subjectId: session.subjectId, status: late ? "late" : "present", method: "qr-geofence", sessionId, locationVerified: true, riskLevel, deviceFingerprint }); if (riskLevel === "high") { db.attendanceReviewQueue ||= []; db.attendanceReviewQueue.unshift({ id: makeId("review"), attendanceId: result.record.id, reason: "device-risk", severity: "high", status: "open", createdAt: new Date().toISOString() }); } await writeDb(db); res.status(201).json({ record: enrichAttendance([result.record], db)[0], location: { distance: location.distance, radiusMeters: location.radiusMeters }, riskLevel }); });

attendanceRouter.get("/dashboard", requireAuth, requireStaff, async (req, res) => { const db = await readDb(); const records = req.user.role === "teacher" ? (db.attendance || []).filter((i) => studentIdsVisibleToTeacher(db, req.user.code).has(i.studentId)) : (db.attendance || []); const analytics = attendanceAnalytics(db, records); const lowAttendance = db.students.filter((s) => { const stats = calculateStudentStats(s.id, records); return stats.total >= 3 && stats.percentage < 75; }).map((s) => { const { password, passwordHistory, passwordVersion, ...safeStudent } = s; return { ...safeStudent, stats: calculateStudentStats(s.id, records) }; }); const queue = (db.attendanceReviewQueue || []).filter((i) => i.status === "open"); res.json({ analytics, lowAttendance, reviewQueue: queue, totals: { records: records.length, sessions: (db.attendanceSessions || []).length, exceptions: queue.length } }); });
// A teacher used to receive the whole review queue, including flagged
// check-ins for students in other departments' classes. Scope it the same way
// every other staff-facing attendance read is scoped.
attendanceRouter.get("/review-queue", requireAuth, requireStaff, async (req, res) => {
  const db = await readDb();
  let queue = db.attendanceReviewQueue || [];
  if (req.user.role === "teacher") {
    const visible = studentIdsVisibleToTeacher(db, req.user.code);
    const attendanceById = new Map((db.attendance || []).map((item) => [item.id, item]));
    queue = queue.filter((item) => visible.has(attendanceById.get(item.attendanceId)?.studentId));
  }
  res.json({ queue });
});
attendanceRouter.patch("/review-queue/:id", requireAuth, requireStaff, async (req, res) => {
  if (!["open", "resolved", "dismissed"].includes(req.body?.status)) return res.status(400).json({ message: "status must be 'open', 'resolved', or 'dismissed'." });
  const db = await readDb();
  const item = (db.attendanceReviewQueue || []).find((i) => i.id === req.params.id);
  if (!item) return res.status(404).json({ message: "Review item not found." });
  if (req.user.role === "teacher") {
    const record = (db.attendance || []).find((i) => i.id === item.attendanceId);
    if (!record || !studentIdsVisibleToTeacher(db, req.user.code).has(record.studentId)) return res.status(403).json({ message: "You can only review flags for students in your classes." });
  }
  item.status = req.body.status; item.resolvedBy = req.user.id; item.resolvedAt = new Date().toISOString();
  await writeDb(db); res.json({ item });
});
attendanceRouter.post("/corrections", requireAuth, async (req, res) => { const { attendanceId, requestedStatus, reason } = req.body || {}; const db = await readDb(); const record = (db.attendance || []).find((i) => i.id === attendanceId); if (!record || !ATTENDANCE_STATUSES.includes(requestedStatus) || typeof reason !== "string" || !reason.trim()) return res.status(400).json({ message: "attendanceId, requestedStatus, and reason are required." }); if (req.user.role === "student" && record.studentId !== req.user.id) return res.status(403).json({ message: "You can only correct your own attendance." });
  // A teacher could file (and then approve, below) a correction against any
  // student in the college, not just the ones they teach.
  if (req.user.role === "teacher" && !studentIdsVisibleToTeacher(db, req.user.code).has(record.studentId)) return res.status(403).json({ message: "You can only request corrections for students in your classes." });
  if ((db.attendanceCorrections || []).some((item) => item.attendanceId === attendanceId && item.requestedBy === req.user.id && item.status === "pending")) return res.status(409).json({ message: "A correction request for this record is already pending." }); db.attendanceCorrections ||= []; const correction = { id: makeId("correction"), attendanceId, requestedStatus, reason: String(reason).slice(0, 500), requestedBy: req.user.id, status: "pending", createdAt: new Date().toISOString() }; db.attendanceCorrections.unshift(correction); await writeDb(db); res.status(201).json({ correction }); });
// Review workflow for the corrections above - follows the same
// GET-list/PATCH-decide shape as the review-queue endpoints just above.
attendanceRouter.get("/corrections", requireAuth, requireStaff, async (req, res) => {
  const db = await readDb();
  const visible = req.user.role === "teacher" ? studentIdsVisibleToTeacher(db, req.user.code) : null;
  const corrections = (db.attendanceCorrections || [])
    .map((item) => ({ item, record: (db.attendance || []).find((i) => i.id === item.attendanceId) }))
    .filter(({ record }) => record && (!visible || visible.has(record.studentId)))
    .map(({ item, record }) => {
      const enriched = enrichAttendance([record], db)[0];
      return { ...item, studentName: enriched.studentName, rollNumber: enriched.rollNumber, className: enriched.className, subjectName: enriched.subjectName, subjectCode: enriched.subjectCode, currentStatus: record.status, date: record.date };
    });
  res.json({ corrections });
});
attendanceRouter.patch("/corrections/:id", requireAuth, requireStaff, async (req, res) => {
  const status = req.body?.status;
  if (!["approved", "rejected"].includes(status)) return res.status(400).json({ message: "status must be 'approved' or 'rejected'." });
  const db = await readDb();
  const correction = (db.attendanceCorrections || []).find((i) => i.id === req.params.id);
  if (!correction) return res.status(404).json({ message: "Correction request not found." });
  if (correction.status !== "pending") return res.status(409).json({ message: "This correction request has already been resolved." });
  const record = (db.attendance || []).find((i) => i.id === correction.attendanceId);
  if (!record) return res.status(404).json({ message: "The underlying attendance record no longer exists." });
  if (req.user.role === "teacher" && !studentIdsVisibleToTeacher(db, req.user.code).has(record.studentId)) return res.status(403).json({ message: "You can only review corrections for students in your classes." });
  if (status === "approved") upsertAttendance(db, { studentId: record.studentId, subjectId: record.subjectId, status: correction.requestedStatus, date: record.date, changedBy: req.user.id, reason: correction.reason });
  correction.status = status;
  correction.resolvedBy = req.user.id;
  correction.resolvedAt = new Date().toISOString();
  await writeDb(db);
  res.json({ correction });
});
attendanceRouter.get("/audit", requireAuth, requireStaff, async (req, res) => { const db = await readDb(); const visible = req.user.role === "teacher" ? studentIdsVisibleToTeacher(db, req.user.code) : null; if (req.query.studentId && visible && !visible.has(req.query.studentId)) return res.status(403).json({ message: "You can only view attendance audit history for students in your classes." }); let records = db.attendance || []; if (req.query.studentId) records = records.filter((i) => i.studentId === req.query.studentId); else if (visible) records = records.filter((i) => visible.has(i.studentId)); const ids = new Set(records.map((i) => i.id)); res.json({ audit: (db.attendanceAudit || []).filter((i) => ids.has(i.attendanceId)).slice(0, 500) }); });
attendanceRouter.get("/export.csv", requireAuth, requireStaff, async (req, res) => { const parsedDate = parseDateParam(req.query.date); if (!parsedDate.valid) return res.status(400).json({ message: "date must be a valid date in YYYY-MM-DD format." }); const db = await readDb(); let records = db.attendance || []; if (req.user.role === "teacher") { const visible = studentIdsVisibleToTeacher(db, req.user.code); records = records.filter((i) => visible.has(i.studentId)); } if (req.query.date) records = records.filter((i) => i.date === req.query.date); res.header("Content-Type", "text/csv"); res.attachment("attendance-report.csv"); res.send(attendanceCsv(records, db)); });
