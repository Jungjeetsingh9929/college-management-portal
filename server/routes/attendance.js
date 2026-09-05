import { Router } from "express";
import { readDb, writeDb } from "../db/fileStore.js";
import { requireAuth, requireStaff } from "../middleware/auth.js";
import { clientKey, rateLimit } from "../middleware/rateLimit.js";
import {
  calculateStudentStats,
  enrichAttendance,
  subjectStats,
  today,
  upsertAttendance,
} from "../services/attendanceService.js";
import { classesTaughtByTeacher, studentIdsVisibleToTeacher } from "../services/accessService.js";

export const attendanceRouter = Router();

attendanceRouter.get("/", requireAuth, async (req, res) => {
  const db = await readDb();
  let records = db.attendance;
  if (req.user.role === "teacher") {
    const visibleStudentIds = studentIdsVisibleToTeacher(db, req.user.code);
    records = records.filter((item) => visibleStudentIds.has(item.studentId));
  }
  if (req.query.studentId) records = records.filter((item) => item.studentId === req.query.studentId);
  if (req.query.subjectId) records = records.filter((item) => item.subjectId === req.query.subjectId);
  if (req.query.date) records = records.filter((item) => item.date === req.query.date);
  if (req.user.role === "student") records = records.filter((item) => item.studentId === req.user.id);
  res.json({ attendance: enrichAttendance(records, db) });
});

attendanceRouter.get("/summary", requireAuth, async (req, res) => {
  const db = await readDb();
  const visibleStudentIds =
    req.user.role === "teacher" ? studentIdsVisibleToTeacher(db, req.user.code) : null;
  const requestedStudentId = req.user.role === "student" ? req.user.id : req.query.studentId;
  if (req.user.role === "teacher" && requestedStudentId && !visibleStudentIds.has(requestedStudentId)) {
    return res.status(403).json({ message: "You can only view attendance for students in your classes." });
  }
  const studentId = requestedStudentId;
  if (studentId) {
    const stats = calculateStudentStats(studentId, db.attendance);
    return res.json({
      stats,
      subjects: subjectStats(studentId, db.subjects, db.attendance),
      today: enrichAttendance(
        db.attendance.filter((item) => item.studentId === studentId && item.date === today()),
        db
      )
    });
  }

  const scopedAttendance = req.user.role === "teacher"
    ? db.attendance.filter((item) => visibleStudentIds.has(item.studentId))
    : db.attendance;
  const present = scopedAttendance.filter((item) => item.status === "present").length;
  const absent = scopedAttendance.filter((item) => item.status === "absent").length;
  res.json({
    stats: {
      students: req.user.role === "teacher" ? visibleStudentIds.size : db.students.length,
      subjects: db.subjects.length,
      present,
      absent,
      percentage: present + absent ? Math.round((present / (present + absent)) * 100) : 0
    },
    today: enrichAttendance(scopedAttendance.filter((item) => item.date === today()), db)
  });
});

// A YYYY-MM-DD date string, matching the format `today()` and every stored
// attendance record use. Returns null if `value` is missing (caller should
// default to today) or invalid.
function parseDateParam(value) {
  if (value === undefined || value === null || value === "") return { date: null, valid: true };
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(new Date(value).getTime())) {
    return { date: null, valid: false };
  }
  return { date: value, valid: true };
}

// Staff roster: for a subject (and optional date, default today), lists every
// student in that subject's class plus their current attendance status, so a
// teacher or admin can mark the class by hand. A teacher only sees rosters for
// classes they actually teach; an admin can see any class.
attendanceRouter.get("/roster", requireAuth, requireStaff, async (req, res) => {
  const { subjectId } = req.query;
  if (!subjectId) return res.status(400).json({ message: "subjectId is required." });

  const { date: parsedDate, valid } = parseDateParam(req.query.date);
  if (!valid) return res.status(400).json({ message: "date must be a valid date in YYYY-MM-DD format." });

  const db = await readDb();
  const subject = db.subjects.find((item) => item.id === subjectId);
  if (!subject) return res.status(404).json({ message: "Subject not found." });

  if (req.user.role === "teacher") {
    const classesTaught = classesTaughtByTeacher(db, req.user.code);
    if (!classesTaught.includes(subject.className)) {
      return res.status(403).json({ message: "You can only mark attendance for classes you teach." });
    }
  }

  const dateToMark = parsedDate || today();
  const roster = db.students
    .filter((student) => student.className === subject.className)
    .map((student) => {
      const existing = db.attendance.find(
        (item) => item.studentId === student.id && item.subjectId === subject.id && item.date === dateToMark
      );
      return {
        studentId: student.id,
        name: student.name,
        rollNumber: student.rollNumber,
        status: existing?.status || null,
        time: existing?.time || null,
        method: existing?.method || null
      };
    });

  res.json({
    subject: { id: subject.id, subjectName: subject.subjectName, code: subject.code, className: subject.className },
    date: dateToMark,
    roster
  });
});

// Staff-only manual marking: a teacher (for their own classes) or an admin
// (for any class) sets a single student's status for a subject/date. This is
// the only way to mark a student present or absent by hand now that student
// self check-in has been removed; the other path into attendance is the
// auto-mark-on-correct-answer quiz flow in shared.js.
attendanceRouter.post(
  "/mark",
  requireAuth,
  requireStaff,
  rateLimit({
    windowMs: 60_000,
    limit: 60,
    message: "Too many attendance updates. Please wait a minute and try again.",
    keyGenerator: (req) => req.user?.id || clientKey(req)
  }),
  async (req, res) => {
    const { studentId, subjectId, status, date } = req.body || {};
    if (!studentId || !subjectId || !["present", "absent"].includes(status)) {
      return res.status(400).json({ message: "studentId, subjectId, and a status of present or absent are required." });
    }
    const { date: parsedDate, valid } = parseDateParam(date);
    if (!valid) return res.status(400).json({ message: "date must be a valid date in YYYY-MM-DD format." });

    const db = await readDb();
    const student = db.students.find((item) => item.id === studentId);
    const subject = db.subjects.find((item) => item.id === subjectId);
    if (!student || !subject) {
      return res.status(404).json({ message: "Student or subject not found." });
    }
    if (student.className !== subject.className) {
      return res.status(400).json({ message: "This student is not enrolled in this subject's class." });
    }
    if (req.user.role === "teacher") {
      const classesTaught = classesTaughtByTeacher(db, req.user.code);
      if (!classesTaught.includes(subject.className)) {
        return res.status(403).json({ message: "You can only mark attendance for classes you teach." });
      }
    }

    const { record } = upsertAttendance(db, {
      studentId: student.id,
      subjectId: subject.id,
      status,
      date: parsedDate,
      method: "manual"
    });
    await writeDb(db);

    res.json({ record: enrichAttendance([record], db)[0] });
  }
);
