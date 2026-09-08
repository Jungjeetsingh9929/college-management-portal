import { format } from "date-fns";
import crypto from "node:crypto";
import { makeId } from "../db/fileStore.js";

export const today = () => format(new Date(), "yyyy-MM-dd");
export const ATTENDANCE_STATUSES = ["present", "absent", "late", "excused"];

export function publicStudent(student, attendance = []) {
  const stats = calculateStudentStats(student.id, attendance);
  const { password, passwordHistory, passwordVersion, ...safeStudent } = student;
  return { ...safeStudent, attendancePercentage: stats.percentage };
}
export function facultyStudent(student, attendance = []) {
  const stats = calculateStudentStats(student.id, attendance);
  return { id: student.id, name: student.name, rollNumber: student.rollNumber, className: student.className, department: student.department, graduationYear: student.graduationYear, attendancePercentage: stats.percentage };
}
export function calculateStudentStats(studentId, attendance) {
  const records = attendance.filter((item) => item.studentId === studentId);
  const present = records.filter((item) => ["present", "late"].includes(item.status)).length;
  const absent = records.filter((item) => item.status === "absent").length;
  const excused = records.filter((item) => item.status === "excused").length;
  const total = records.length;
  const percentage = total ? Math.round((present / total) * 100) : 0;
  return { present, absent, excused, total, percentage };
}
export function subjectStats(studentId, subjects, attendance) {
  return subjects.map((subject) => {
    const stats = calculateStudentStats(studentId, attendance.filter((item) => item.subjectId === subject.id));
    return { subjectId: subject.id, subjectName: subject.subjectName, code: subject.code, teacher: subject.teacher, ...stats };
  });
}
export function createQrToken(sessionId, sequence = 0) {
  return crypto.createHash("sha256").update(`${sessionId}:${sequence}:${crypto.randomUUID()}`).digest("hex").slice(0, 24);
}
export function upsertAttendance(db, payload) {
  const date = payload.date || today();
  const time = payload.time || format(new Date(), "HH:mm");
  const status = ATTENDANCE_STATUSES.includes(payload.status) ? payload.status : "absent";
  const existing = db.attendance.find((item) => item.studentId === payload.studentId && item.subjectId === payload.subjectId && item.date === date);
  const previous = existing ? { ...existing } : null;
  if (existing) {
    Object.assign(existing, { status, time, method: payload.method || existing.method || "manual", sessionId: payload.sessionId || existing.sessionId || null, riskLevel: payload.riskLevel || existing.riskLevel || "low", locationVerified: payload.locationVerified ?? existing.locationVerified ?? null });
    db.attendanceAudit ||= [];
    db.attendanceAudit.unshift({ id: makeId("att-audit"), attendanceId: existing.id, action: "updated", previous, next: { ...existing }, changedBy: payload.changedBy || null, changedAt: new Date().toISOString(), reason: payload.reason || null });
    return { record: existing, previous, duplicatePrevented: true };
  }
  const record = { id: makeId("att"), studentId: payload.studentId, subjectId: payload.subjectId, date, status, time, method: payload.method || "manual", sessionId: payload.sessionId || null, riskLevel: payload.riskLevel || "low", locationVerified: payload.locationVerified ?? null, deviceFingerprint: payload.deviceFingerprint || null };
  db.attendance.unshift(record);
  db.attendanceAudit ||= [];
  db.attendanceAudit.unshift({ id: makeId("att-audit"), attendanceId: record.id, action: "created", previous: null, next: { ...record }, changedBy: payload.changedBy || null, changedAt: new Date().toISOString(), reason: payload.reason || null });
  return { record, previous: null, duplicatePrevented: false };
}
export function enrichAttendance(records, db) {
  return records.map((record) => {
    const student = db.students.find((item) => item.id === record.studentId);
    const subject = db.subjects.find((item) => item.id === record.subjectId);
    return { ...record, studentName: student?.name || "Unknown student", rollNumber: student?.rollNumber || "-", className: student?.className || "-", subjectName: subject?.subjectName || "Unknown subject", subjectCode: subject?.code || "-" };
  });
}
export function attendanceAnalytics(db, records = db.attendance) {
  const by = (key) => Object.values(records.reduce((acc, item) => { const entity = key(item); acc[entity] ||= { key: entity, total: 0, present: 0, absent: 0, late: 0, excused: 0 }; acc[entity].total++; acc[entity][item.status] = (acc[entity][item.status] || 0) + 1; return acc; }, {})).map((item) => ({ ...item, percentage: item.total ? Math.round(((item.present + item.late) / item.total) * 100) : 0 }));
  return { byStudent: by((i) => i.studentId), bySubject: by((i) => i.subjectId), byClass: by((i) => db.students.find((s) => s.id === i.studentId)?.className || "Unknown"), byDepartment: by((i) => db.students.find((s) => s.id === i.studentId)?.department || "Unknown"), byTeacher: by((i) => db.subjects.find((s) => s.id === i.subjectId)?.teacher || "Unassigned") };
}
export function csvEscape(value) { return `"${String(value ?? "").replaceAll('"', '""')}"`; }
export function attendanceCsv(records, db) {
  const headers = ["date", "time", "student", "rollNumber", "class", "department", "subject", "status", "method", "riskLevel", "locationVerified"];
  const rows = enrichAttendance(records, db).map((item) => [item.date, item.time, item.studentName, item.rollNumber, item.className, db.students.find((s) => s.id === item.studentId)?.department, item.subjectName, item.status, item.method, item.riskLevel || "low", item.locationVerified ?? ""]);
  return [headers, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n") + "\n";
}
