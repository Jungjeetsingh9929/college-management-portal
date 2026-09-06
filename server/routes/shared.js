import { Router } from "express";
import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import multer from "multer";
import { makeId, readDb, writeDb } from "../db/fileStore.js";
import { requireAuth } from "../middleware/auth.js";
import { clientKey, rateConfig, rateLimit } from "../middleware/rateLimit.js";
import { calculateStudentStats, enrichAttendance, publicStudent, subjectStats, today } from "../services/attendanceService.js";
import { parseAnswerIndex, requiredText } from "../services/validation.js";
import { getCollegeGeofence, isWithinCollege } from "../utils/geo.js";
import { classesTaughtByTeacher, scheduleBelongsToTeacher } from "../services/accessService.js";

export const sharedRouter = Router();
const uploadRoot = path.resolve(process.env.UPLOAD_DIR || path.join(process.cwd(), "storage", "submissions"));
const submissionUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: Number(process.env.SUBMISSION_MAX_BYTES) || 5 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => { const extensions = { "application/pdf": ".pdf", "image/png": ".png", "image/jpeg": ".jpg" }; const name = path.extname(file.originalname || "").toLowerCase(); callback(null, extensions[file.mimetype] === name || (file.mimetype === "image/jpeg" && name === ".jpeg")); }
});

function hasMagicBytes(file) {
  const header = file.buffer.subarray(0, 8);
  return (file.mimetype === "application/pdf" && header.toString("ascii", 0, 5) === "%PDF-") ||
    (file.mimetype === "image/png" && header.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
    (file.mimetype === "image/jpeg" && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff);
}

function publicAssignment(db, assignment, studentId) {
  const completion = (db.assignmentCompletions || []).find((item) => item.assignmentId === assignment.id && item.studentId === studentId);
  return { ...assignment, completed: Boolean(completion), submissionText: completion?.submissionText || "", submissionLink: completion?.submissionLink || "", submissionFile: completion?.submissionFile || null, status: computeAssignmentStatus(assignment.dueDate, Boolean(completion)) };
}

function buildNotifications(db, user) {
  const notifications = [];
  const push = (id, category, title, body, createdAt, href = "") => notifications.push({ id, category, title, body, createdAt: createdAt || new Date().toISOString(), href });
  const student = user.role === "student" ? (db.students || []).find((item) => item.id === user.id) : null;
  (db.notices || []).filter((item) => user.role === "admin" || (user.role === "teacher" && item.teacherId === user.id) || (student && (!item.className || item.className === student.className))).slice(0, 12).forEach((item) => push(`notice:${item.id}`, item.category === "emergency" ? "security" : "notice", item.title, item.body || "New notice published.", item.createdAt, "/complaints"));
  if (student) {
    (db.assignments || []).filter((item) => item.className === student.className && !((db.assignmentCompletions || []).some((completion) => completion.assignmentId === item.id && completion.studentId === student.id))).slice(0, 8).forEach((item) => push(`assignment:${item.id}`, "assignment", `Assignment deadline: ${item.title}`, `Due ${item.dueDate}.`, item.createdAt, "/assignments"));
    const stats = calculateStudentStats(student.id, db.attendance || []); if (stats.total && stats.percentage < 75) push(`attendance:${student.id}`, "attendance", "Attendance warning", `Your attendance is ${stats.percentage}%.`, new Date().toISOString(), "/history");
    (db.examinations || []).filter((item) => !item.className || item.className === student.className).slice(0, 6).forEach((item) => push(`exam:${item.id}`, "exam", `Exam announcement: ${item.subject}`, `${item.date || "Date to be announced"}${item.room ? ` · Room ${item.room}` : ""}.`, item.createdAt || item.date, "/student"));
    (db.results || []).filter((item) => item.studentId === student.id).slice(0, 6).forEach((item) => push(`result:${item.id}`, "result", "Result published", item.subject || "Your academic result is available.", item.publishedAt, "/student"));
  }
  if (user.role === "teacher") (db.assignments || []).filter((item) => item.teacherId === user.id).slice(0, 8).forEach((item) => push(`faculty-assignment:${item.id}`, "assignment", `Assignment: ${item.title}`, `Class ${item.className} · due ${item.dueDate}.`, item.createdAt, "/faculty/assignments"));
  if (user.role === "admin") { const pending = (db.pendingStudents || []).filter((item) => item.approvalStatus === "pending").length; if (pending) push("security:pending", "security", "Pending student approvals", `${pending} registration request${pending > 1 ? "s" : ""} require review.`, new Date().toISOString(), "/admin"); const inactive = (db.students || []).filter((item) => item.active === false).length; if (inactive) push("security:inactive", "security", "Inactive accounts", `${inactive} student account${inactive > 1 ? "s are" : " is"} inactive.`, new Date().toISOString(), "/admin"); }
  return notifications.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function buildSearchIndex(db, user) {
  const results = [];
  const add = (type, id, title, subtitle, href, value = "") => results.push({ type, id, title, subtitle, href, searchText: `${title} ${subtitle} ${value}`.toLowerCase() });
  if (user.role === "admin") {
    (db.students || []).forEach((item) => add("student", item.id, item.name, `${item.rollNumber} · ${item.className}`, "/admin", item.email));
    (db.teachers || []).forEach((item) => add("faculty", item.id, item.name, `${item.code} · ${item.department}`, "/teachers", item.email));
    (db.departments || []).forEach((item) => add("department", item.id, item.name, "Department", "/admin/resources"));
    (db.subjects || []).forEach((item) => add("subject", item.id, item.subjectName, `${item.code} · ${item.className}`, "/subjects"));
    (db.classrooms || []).forEach((item) => add("classroom", item.id, item.name, `${item.building} · capacity ${item.capacity}`, "/admin/resources"));
    (db.schedules || []).forEach((item) => add("timetable", item.id, item.subject, `${item.day} · ${item.startTime}-${item.endTime} · ${item.section}`, "/central-timetable", `${item.teacher} ${item.room}`));
  } else if (user.role === "teacher") {
    const classes = classesTaughtByTeacher(db, user.code); (db.students || []).filter((item) => classes.includes(item.className)).forEach((item) => add("student", item.id, item.name, `${item.rollNumber} · ${item.className}`, "/faculty", item.email));
    (db.subjects || []).filter((item) => classes.includes(item.className)).forEach((item) => add("subject", item.id, item.subjectName, `${item.code} · ${item.className}`, "/schedule"));
    (db.schedules || []).filter((item) => scheduleBelongsToTeacher(item, user.code)).forEach((item) => add("class", item.id, item.subject, `${item.day} · ${item.startTime}-${item.endTime} · ${item.section}`, "/schedule", item.room));
    (db.assignments || []).filter((item) => item.teacherId === user.id).forEach((item) => add("assignment", item.id, item.title, `${item.className} · due ${item.dueDate}`, "/faculty/assignments", item.description));
  } else {
    const student = (db.students || []).find((item) => item.id === user.id); const className = student?.className;
    (db.subjects || []).filter((item) => item.className === className).forEach((item) => add("subject", item.id, item.subjectName, `${item.code} · ${item.teacher}`, "/schedule"));
    (db.teachers || []).forEach((item) => add("faculty", item.id, item.name, item.department, "/teachers", item.email));
    (db.notices || []).filter((item) => !item.className || item.className === className).forEach((item) => add("notice", item.id, item.title, item.category || "Notice", "/student", item.body));
    (db.assignments || []).filter((item) => item.className === className).forEach((item) => add("assignment", item.id, item.title, `Due ${item.dueDate}`, "/assignments", item.description));
    (db.examinations || []).filter((item) => !item.className || item.className === className).forEach((item) => add("exam", item.id, item.subject, `${item.date || "Date TBA"} · ${item.room || "Room TBA"}`, "/student"));
  }
  return results;
}

// 1. Get year schedule (holidays) - open to any authenticated user
sharedRouter.get("/holidays", requireAuth, async (req, res) => {
  const db = await readDb();
  res.json({ holidays: db.holidays || [] });
});

sharedRouter.get("/search", requireAuth, async (req, res) => {
  const query = String(req.query.q || "").trim().slice(0, 100); const db = await readDb(); const index = buildSearchIndex(db, req.user);
  if (!query) return res.json({ query: "", suggestions: index.slice(0, 8).map(({ searchText, ...item }) => item), results: [], total: 0 });
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean); const results = index.filter((item) => terms.every((term) => item.searchText.includes(term))).slice(0, 30).map(({ searchText, ...item }) => item);
  res.json({ query, suggestions: results.slice(0, 8), results, total: results.length });
});

sharedRouter.get("/notifications", requireAuth, async (req, res) => {
  const db = await readDb(); db.notificationReads ||= {};
  const notifications = buildNotifications(db, req.user); const readIds = new Set(db.notificationReads[req.user.id] || []);
  res.json({ notifications: notifications.map((item) => ({ ...item, read: readIds.has(item.id) })), unreadCount: notifications.filter((item) => !readIds.has(item.id)).length });
});

sharedRouter.post("/notifications/:id/read", requireAuth, async (req, res) => {
  const db = await readDb(); db.notificationReads ||= {}; const current = new Set(db.notificationReads[req.user.id] || []); current.add(String(req.params.id)); db.notificationReads[req.user.id] = [...current].slice(-500); await writeDb(db); res.json({ ok: true });
});

sharedRouter.post("/notifications/read-all", requireAuth, async (req, res) => {
  const db = await readDb(); db.notificationReads ||= {}; db.notificationReads[req.user.id] = buildNotifications(db, req.user).map((item) => item.id).slice(-500); await writeDb(db); res.json({ ok: true });
});

sharedRouter.get("/student/portal", requireAuth, async (req, res) => {
  if (req.user.role !== "student") return res.status(403).json({ message: "Student access required." });
  const db = await readDb();
  const student = (db.students || []).find((item) => item.id === req.user.id);
  if (!student) return res.status(404).json({ message: "Student not found." });
  const attendance = db.attendance || [];
  const assignments = (db.assignments || []).filter((item) => item.className === student.className).map((item) => publicAssignment(db, item, student.id));
  const schedule = (db.schedules || []).filter((item) => item.section === student.className).sort((a, b) => a.day.localeCompare(b.day) || a.period - b.period);
  const stats = calculateStudentStats(student.id, attendance);
  res.json({
    student: publicStudent(student, attendance),
    schedule,
    attendance: { stats, subjects: subjectStats(student.id, db.subjects || [], attendance), today: enrichAttendance(attendance.filter((item) => item.studentId === student.id && item.date === today()), db) },
    assignments,
    examinations: (db.examinations || []).filter((item) => !item.className || item.className === student.className),
    notices: (db.notices || []).filter((item) => !item.className || item.className === student.className).slice(0, 12),
    fees: (db.fees || []).find((item) => item.studentId === student.id) || { status: "not-published", amountDue: 0, dueDate: null },
    academics: student.academics || { sgpa: null, cgpa: null, subjects: [] },
    holidays: (db.holidays || []).slice(0, 8)
  });
});

// Compute an urgency status for an assignment relative to today, factoring in completion.
function computeAssignmentStatus(dueDate, completed) {
  if (completed) return "completed";

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const due = new Date(dueDate);
  due.setHours(0, 0, 0, 0);

  const msPerDay = 24 * 60 * 60 * 1000;
  const daysUntilDue = Math.round((due.getTime() - today.getTime()) / msPerDay);

  if (daysUntilDue < 0) return "overdue";
  if (daysUntilDue <= 3) return "due-soon";
  return "upcoming";
}

// 2. Student route: Get assignments for their class
sharedRouter.get("/student/assignments", requireAuth, async (req, res) => {
  if (req.user.role !== "student") return res.status(403).json({ message: "Student access required." });
  
  const db = await readDb();
  db.assignments ||= [];
  db.assignmentCompletions ||= [];
  
  // Assuming req.user has className for students. If not, fetch from db.
  const student = db.students.find(s => s.id === req.user.id);
  if (!student) return res.status(404).json({ message: "Student not found." });

  const assignments = db.assignments
    .filter(a => a.className === student.className)
    .map((a) => {
      const completion = db.assignmentCompletions.find(
        (c) => c.assignmentId === a.id && c.studentId === student.id
      );
      const completed = !!completion;
      return {
        ...a,
        completed,
        submissionText: completion ? completion.submissionText : "",
        submissionLink: completion ? completion.submissionLink : "",
        status: computeAssignmentStatus(a.dueDate, completed)
      };
    });

  res.json({ assignments });
});

const completeRateLimit = rateLimit({
  ...rateConfig("STUDENT_COMPLETION", { windowMs: 5 * 60 * 1000, limit: 20 }),
  message: "Too many completion toggles. Please try again later.",
  keyGenerator: (req) => req.user?.id || clientKey(req)
});

// 2b. Student route: mark an assignment complete/incomplete (toggle via POST/DELETE)
sharedRouter.post("/student/assignments/:id/complete", requireAuth, completeRateLimit, async (req, res) => {
  if (req.user.role !== "student") return res.status(403).json({ message: "Student access required." });

  const db = await readDb();
  db.assignments ||= [];
  db.assignmentCompletions ||= [];

  const student = db.students.find((s) => s.id === req.user.id);
  if (!student) return res.status(404).json({ message: "Student not found." });

  const assignment = db.assignments.find((a) => a.id === req.params.id);
  if (!assignment) return res.status(404).json({ message: "Assignment not found." });
  if (assignment.className !== student.className) {
    return res.status(403).json({ message: "This assignment is not for your class." });
  }

  const { submissionText, submissionLink } = req.body || {};
  let text = "";
  let link = "";
  
  if (submissionText) {
    text = requiredText(submissionText, "Submission text", { max: 2000 });
  }
  if (submissionLink) {
    link = String(submissionLink).trim();
    if (!link.startsWith("http")) {
      return res.status(400).json({ message: "Link must start with http/https." });
    }
  }

  const existingIndex = db.assignmentCompletions.findIndex(
    (c) => c.assignmentId === assignment.id && c.studentId === student.id
  );
  if (existingIndex >= 0) {
    db.assignmentCompletions[existingIndex].submissionText = text;
    db.assignmentCompletions[existingIndex].submissionLink = link;
    db.assignmentCompletions[existingIndex].completedAt = new Date().toISOString();
  } else {
    db.assignmentCompletions.push({
      id: makeId("cmp"),
      assignmentId: assignment.id,
      studentId: student.id,
      completedAt: new Date().toISOString(),
      submissionText: text,
      submissionLink: link
    });
  }
  await writeDb(db);

  res.json({ completed: true });
});

sharedRouter.post("/student/assignments/:id/submission", requireAuth, completeRateLimit, (req, res, next) => {
  submissionUpload.single("file")(req, res, (error) => {
    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") return res.status(413).json({ message: "Submission file is too large." });
    if (error || !req.file) return res.status(400).json({ message: "Submit one PDF, PNG, or JPEG file." });
    next();
  });
}, async (req, res) => {
  if (req.user.role !== "student") return res.status(403).json({ message: "Student access required." });
  if (!hasMagicBytes(req.file)) return res.status(400).json({ message: "The uploaded file content does not match its declared type." });
  const db = await readDb();
  db.assignments ||= [];
  db.assignmentCompletions ||= [];
  const student = db.students.find((item) => item.id === req.user.id);
  const assignment = db.assignments.find((item) => item.id === req.params.id && item.className === student?.className);
  if (!student || !assignment) return res.status(404).json({ message: "Assignment not found." });
  await fs.mkdir(uploadRoot, { recursive: true, mode: 0o700 });
  const extension = req.file.mimetype === "application/pdf" ? "pdf" : req.file.mimetype === "image/png" ? "png" : "jpg";
  const storedName = `${crypto.randomUUID()}.${extension}`;
  await fs.writeFile(path.join(uploadRoot, storedName), req.file.buffer, { mode: 0o600 });
  const existing = db.assignmentCompletions.find((item) => item.assignmentId === assignment.id && item.studentId === student.id);
  const completion = existing || { id: makeId("cmp"), assignmentId: assignment.id, studentId: student.id };
  completion.completedAt = new Date().toISOString();
  completion.submissionFile = { name: req.file.originalname.slice(0, 120), type: req.file.mimetype, size: req.file.size, storedName };
  if (!existing) db.assignmentCompletions.push(completion);
  await writeDb(db);
  res.json({ completed: true, submissionFile: completion.submissionFile });
});

sharedRouter.delete("/student/assignments/:id/complete", requireAuth, completeRateLimit, async (req, res) => {
  if (req.user.role !== "student") return res.status(403).json({ message: "Student access required." });

  const db = await readDb();
  db.assignments ||= [];
  db.assignmentCompletions ||= [];

  const student = db.students.find((s) => s.id === req.user.id);
  if (!student) return res.status(404).json({ message: "Student not found." });

  const assignment = db.assignments.find((a) => a.id === req.params.id);
  if (!assignment) return res.status(404).json({ message: "Assignment not found." });
  if (assignment.className !== student.className) {
    return res.status(403).json({ message: "This assignment is not for your class." });
  }

  db.assignmentCompletions = db.assignmentCompletions.filter(
    (c) => !(c.assignmentId === assignment.id && c.studentId === student.id)
  );
  await writeDb(db);

  res.json({ completed: false });
});

// Student route: list active, unattempted quizzes for the student's class.
// Polled by the client to power the in-app "new attendance question" notification.
sharedRouter.get("/quiz/active", requireAuth, async (req, res) => {
  if (req.user.role !== "student") return res.status(403).json({ message: "Student access required." });

  const db = await readDb();
  db.quizzes ||= [];
  db.quizAttempts ||= [];

  const student = db.students.find((s) => s.id === req.user.id);
  if (!student) return res.status(404).json({ message: "Student not found." });

  const subjects = db.subjects || [];
  const active = db.quizzes
    .filter((quiz) => quiz.active && quiz.className === student.className)
    .filter((quiz) => !db.quizAttempts.some((attempt) => attempt.quizId === quiz.id && attempt.studentId === student.id))
    .map((quiz) => {
      const subject = subjects.find((s) => s.id === quiz.subjectId);
      return {
        id: quiz.id,
        subjectName: subject ? subject.subjectName : "Unknown Subject",
        createdAt: quiz.createdAt
      };
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  res.json({ quizzes: active });
});

// Fetch a single quiz for answering (without exposing the correct answer index)
sharedRouter.get("/quiz/:id", requireAuth, async (req, res) => {
  const db = await readDb();
  db.quizzes ||= [];
  const quiz = db.quizzes.find(q => q.id === req.params.id);
  
  if (!quiz) return res.status(404).json({ message: "Quiz not found." });
  if (!quiz.active) return res.status(400).json({ message: "Quiz is no longer active." });
  
  const subject = (db.subjects || []).find(s => s.id === quiz.subjectId);
  const student = req.user.role === "student"
    ? (db.students || []).find((item) => item.id === req.user.id)
    : null;
  if (req.user.role === "student" && (!student || student.className !== quiz.className)) {
    return res.status(403).json({ message: "You are not in the class for this quiz." });
  }
  const attempted = req.user.role === "student" &&
    (db.quizAttempts || []).some((attempt) => attempt.quizId === quiz.id && attempt.studentId === req.user.id);
  
  const safeQuiz = {
    id: quiz.id,
    question: quiz.question,
    options: quiz.options,
    className: quiz.className,
    subjectName: subject ? subject.subjectName : "Unknown Subject",
    attempted
  };
  
  res.json({ quiz: safeQuiz });
});

// 3. Student route: Answer quiz and mark attendance
sharedRouter.post("/student/quiz/:id/answer", requireAuth, rateLimit({
  ...rateConfig("STUDENT_QUIZ_ANSWER", { windowMs: 5 * 60 * 1000, limit: 10 }),
  message: "Too many quiz submissions. Please try again later.",
  keyGenerator: (req) => req.user?.id || clientKey(req)
}), async (req, res) => {
  if (req.user.role !== "student") return res.status(403).json({ message: "Student access required." });

  // Campus-only gate: this endpoint marks attendance, so it must be verified
  // that the device is physically on campus before anything else is checked
  // (question correctness, existing attempts, etc).
  const { latitude, longitude, accuracy } = req.body || {};
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ message: "Location is required to answer an attendance question. Please allow location access and try again." });
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return res.status(400).json({ message: "Invalid coordinates." });
  }

  const geofence = getCollegeGeofence();
  if (!geofence) {
    return res.status(503).json({ message: "Location-based attendance isn't configured on this server yet." });
  }

  const db = await readDb();
  db.quizzes ||= [];
  db.attendance ||= [];
  db.quizAttempts ||= [];
  
  const quiz = db.quizzes.find(q => q.id === req.params.id);
  if (!quiz) return res.status(404).json({ message: "Quiz not found." });
  if (!quiz.active) return res.status(400).json({ message: "Quiz is no longer active." });
  
  const student = db.students.find(s => s.id === req.user.id);
  if (!student) return res.status(404).json({ message: "Student not found." });
  if (quiz.className !== student.className) {
    return res.status(403).json({ message: "You are not in the class for this quiz." });
  }

  const { withinRange, distance, radiusMeters } = isWithinCollege(lat, lng, accuracy);
  if (!withinRange) {
    return res.status(403).json({
      message: `You're about ${distance}m from campus. You need to be within ${radiusMeters}m of the college to answer an attendance question.`,
      distance,
      radiusMeters
    });
  }

  const { answerIndex } = req.body;
  const parsedAnswerIndex = parseAnswerIndex(answerIndex, quiz.options.length);
  if (parsedAnswerIndex === null) {
    return res.status(400).json({ message: "Answer index must point to a valid option." });
  }
  const previousAttempt = db.quizAttempts.find(
    (attempt) => attempt.quizId === quiz.id && attempt.studentId === student.id
  );
  if (previousAttempt) {
    return res.status(409).json({ message: "You have already submitted an answer for this quiz." });
  }

  const isCorrect = parsedAnswerIndex === quiz.correctAnswerIndex;
  db.quizAttempts.push({
    id: makeId("attempt"),
    quizId: quiz.id,
    studentId: student.id,
    answerIndex: parsedAnswerIndex,
    correct: isCorrect,
    createdAt: new Date().toISOString()
  });

  if (isCorrect) {
    // Mark present
    const date = new Date().toISOString().split("T")[0];
    const time = new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit" });

    // Check if already marked present
    const existing = db.attendance.find(a => a.studentId === student.id && a.subjectId === quiz.subjectId && a.date === date);
    if (existing) {
       await writeDb(db);
       return res.json({ correct: true, message: "Correct answer! You were already marked present for today.", attendanceId: existing.id });
    }

    const attendanceRecord = {
      id: makeId("att"),
      studentId: student.id,
      subjectId: quiz.subjectId,
      date,
      status: "present",
      time,
      method: "quiz"
    };
    db.attendance.push(attendanceRecord);
    await writeDb(db);
    return res.json({ correct: true, message: "Correct answer! Attendance marked present.", attendanceId: attendanceRecord.id });
  } else {
    await writeDb(db);
    return res.json({ correct: false, message: "Incorrect answer. You have used your one attempt; attendance was not marked." });
  }
});
