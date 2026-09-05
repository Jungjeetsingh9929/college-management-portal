import { format } from "date-fns";
import { makeId } from "../db/fileStore.js";

export const today = () => format(new Date(), "yyyy-MM-dd");

export function publicStudent(student, attendance = []) {
  const stats = calculateStudentStats(student.id, attendance);
  const { password, ...safeStudent } = student;
  return { ...safeStudent, attendancePercentage: stats.percentage };
}

export function calculateStudentStats(studentId, attendance) {
  const records = attendance.filter((item) => item.studentId === studentId);
  const present = records.filter((item) => item.status === "present").length;
  const absent = records.filter((item) => item.status === "absent").length;
  const total = records.length;
  const percentage = total ? Math.round((present / total) * 100) : 0;
  return { present, absent, total, percentage };
}

export function subjectStats(studentId, subjects, attendance) {
  return subjects.map((subject) => {
    const records = attendance.filter(
      (item) => item.studentId === studentId && item.subjectId === subject.id
    );
    const present = records.filter((item) => item.status === "present").length;
    const total = records.length;
    return {
      subjectId: subject.id,
      subjectName: subject.subjectName,
      code: subject.code,
      teacher: subject.teacher,
      total,
      present,
      absent: total - present,
      percentage: total ? Math.round((present / total) * 100) : 0
    };
  });
}

export function upsertAttendance(db, payload) {
  const date = payload.date || today();
  const time = payload.time || format(new Date(), "HH:mm");
  const existing = db.attendance.find(
    (item) =>
      item.studentId === payload.studentId &&
      item.subjectId === payload.subjectId &&
      item.date === date
  );

  if (existing) {
    existing.status = payload.status;
    existing.time = time;
    existing.method = payload.method || existing.method || "manual";
    return { record: existing, duplicatePrevented: true };
  }

  const record = {
    id: makeId("att"),
    studentId: payload.studentId,
    subjectId: payload.subjectId,
    date,
    status: payload.status,
    time,
    method: payload.method || "manual"
  };
  db.attendance.unshift(record);
  return { record, duplicatePrevented: false };
}

export function enrichAttendance(records, db) {
  return records.map((record) => {
    const student = db.students.find((item) => item.id === record.studentId);
    const subject = db.subjects.find((item) => item.id === record.subjectId);
    return {
      ...record,
      studentName: student?.name || "Unknown student",
      rollNumber: student?.rollNumber || "-",
      className: student?.className || "-",
      subjectName: subject?.subjectName || "Unknown subject",
      subjectCode: subject?.code || "-"
    };
  });
}
