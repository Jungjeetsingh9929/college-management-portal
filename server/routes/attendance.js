import { Router } from "express";
import { readDb, writeDb } from "../db/fileStore.js";
import { requireAuth } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rateLimit.js";
import {
  calculateStudentStats,
  enrichAttendance,
  subjectStats,
  today,
  upsertAttendance,
} from "../services/attendanceService.js";
import { studentIdsVisibleToTeacher } from "../services/accessService.js";
import { getCollegeGeofence, isWithinCollege } from "../utils/geo.js";

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

// Student self check-in: works from anywhere in the country, but marking
// yourself present only succeeds when the browser's GPS location falls
// inside the configured college geofence. Lists the student's own class
// subjects and whether each is already marked for today.
attendanceRouter.get("/checkin-options", requireAuth, async (req, res) => {
  if (req.user.role !== "student") {
    return res.status(403).json({ message: "Student access is required." });
  }

  const db = await readDb();
  const student = db.students.find((item) => item.id === req.user.id);
  if (!student) return res.status(404).json({ message: "Student record not found." });

  const dateToday = today();
  const classSubjects = db.subjects.filter((subject) => subject.className === student.className);

  const options = classSubjects.map((subject) => {
    const existing = db.attendance.find(
      (item) => item.studentId === student.id && item.subjectId === subject.id && item.date === dateToday
    );
    return {
      subjectId: subject.id,
      subjectName: subject.subjectName,
      code: subject.code,
      teacher: subject.teacher,
      alreadyMarked: Boolean(existing),
      status: existing?.status || null,
      time: existing?.time || null
    };
  });

  res.json({ options, geofenceConfigured: Boolean(getCollegeGeofence()) });
});

attendanceRouter.post(
  "/checkin",
  requireAuth,
  rateLimit({
    windowMs: 60_000,
    limit: 10,
    message: "Too many attendance check-in attempts. Please wait a minute and try again."
  }),
  async (req, res) => {
    if (req.user.role !== "student") {
      return res.status(403).json({ message: "Student access is required." });
    }

    const { subjectId, latitude, longitude, accuracy } = req.body || {};
    const lat = Number(latitude);
    const lng = Number(longitude);

    if (!subjectId || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ message: "subjectId, latitude, and longitude are required." });
    }
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return res.status(400).json({ message: "Invalid coordinates." });
    }

    const geofence = getCollegeGeofence();
    if (!geofence) {
      return res.status(503).json({ message: "Location-based attendance isn't configured on this server yet." });
    }

    const db = await readDb();
    const student = db.students.find((item) => item.id === req.user.id);
    const subject = db.subjects.find((item) => item.id === subjectId);
    if (!student || !subject) {
      return res.status(404).json({ message: "Student or subject not found." });
    }
    if (subject.className !== student.className) {
      return res.status(403).json({ message: "This subject is not part of your class." });
    }

    const { withinRange, distance, radiusMeters } = isWithinCollege(lat, lng, accuracy);
    if (!withinRange) {
      return res.status(403).json({
        message: `You're about ${distance}m from campus. You need to be within ${radiusMeters}m of the college to mark attendance.`,
        distance,
        radiusMeters
      });
    }

    const { record, duplicatePrevented } = upsertAttendance(db, {
      studentId: student.id,
      subjectId: subject.id,
      status: "present",
      method: "self-checkin-geo"
    });
    await writeDb(db);

    res.json({
      record: enrichAttendance([record], db)[0],
      distance,
      radiusMeters,
      alreadyMarked: duplicatePrevented,
      message: duplicatePrevented
        ? "Attendance was already marked for this class today \u2014 timestamp updated."
        : "You're on campus \u2014 attendance marked."
    });
  }
);
