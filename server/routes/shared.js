import { Router } from "express";
import crypto from "node:crypto";
import multer from "multer";
import { makeId, readDb, writeDb } from "../db/fileStore.js";
import { deleteFile, loadFile, saveFile } from "../db/blobStore.js";
import { requireAuth } from "../middleware/auth.js";
import { clientKey, rateConfig, rateLimit } from "../middleware/rateLimit.js";
import { calculateStudentStats, enrichAttendance, publicStudent, subjectStats, today, upsertAttendance } from "../services/attendanceService.js";
import { parseAnswerIndex, requiredText } from "../services/validation.js";
import { getCollegeGeofence, isWithinCollege } from "../utils/geo.js";
import { classesTaughtByTeacher, scheduleBelongsToTeacher, subjectAssignedToTeacher } from "../services/accessService.js";
import { academicsFor } from "../services/marksService.js";
import { isProjectMember } from "../services/projectService.js";
import { ensureCollections, publicStudentFee } from "./fees.js";
import { cleanFileName, extensionForMimetype, hasValidFileSignature, uploadFileFilter } from "../services/uploadValidation.js";
import { resolveUploadRoot } from "../utils/uploadRoot.js";

export const sharedRouter = Router();
const uploadRoot = resolveUploadRoot("submissions");
const facultyUploadRoot = resolveUploadRoot("faculty-notes");
// Reference material a teacher attaches to an assignment (not a submission).
// Kept in its own folder so it's never confused with student submissions.
const assignmentAttachmentRoot = resolveUploadRoot("assignment-attachments");
const submissionUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: Number(process.env.SUBMISSION_MAX_BYTES) || 5 * 1024 * 1024 },
  fileFilter: uploadFileFilter
});

// A notice is visible to a student if it's a department-level notice (posted
// by an HOD) matching their department, a class-level notice matching their
// class, or has neither field set (a campus-wide broadcast). Department
// notices have no className, so without this check they were falling through
// the "!item.className" campus-wide branch and reaching every student.
function noticeVisibleToStudent(item, student) {
  if (item.departmentId || item.departmentName) return item.departmentName === student.department;
  if (item.className) return item.className === student.className;
  return true;
}

// Shared shape for how a single assignment looks from a student's point of
// view, whether it's rendered on the dashboard overview or the dedicated
// assignments page — includes their submission (text/link/files) and, once
// graded, their marks/feedback.
function studentAssignmentView(assignment, completion) {
  return {
    ...assignment,
    completed: Boolean(completion),
    submissionText: completion?.submissionText || "",
    submissionLink: completion?.submissionLink || "",
    submissionFiles: completion?.submissionFiles || [],
    marks: completion?.marks ?? null,
    maxMarks: completion?.maxMarks ?? null,
    feedback: completion?.feedback || "",
    evaluatedAt: completion?.evaluatedAt || null,
    status: computeAssignmentStatus(assignment.dueDate, completion)
  };
}

function publicAssignment(db, assignment, studentId) {
  const completion = (db.assignmentCompletions || []).find((item) => item.assignmentId === assignment.id && item.studentId === studentId);
  return studentAssignmentView(assignment, completion);
}

function buildNotifications(db, user) {
  const notifications = [];
  const push = (id, category, title, body, createdAt, href = "") => notifications.push({ id, category, title, body, createdAt: createdAt || new Date().toISOString(), href });
  const student = user.role === "student" ? (db.students || []).find((item) => item.id === user.id) : null;
  (db.notices || []).filter((item) => user.role === "admin" || (user.role === "teacher" && item.teacherId === user.id) || (student && noticeVisibleToStudent(item, student))).slice(0, 12).forEach((item) => push(`notice:${item.id}`, item.category === "emergency" ? "security" : "notice", item.title, item.body || "New notice published.", item.createdAt, "/complaints"));
  if (student) {
    (db.assignments || []).filter((item) => item.className === student.className && !((db.assignmentCompletions || []).some((completion) => completion.assignmentId === item.id && completion.studentId === student.id))).slice(0, 8).forEach((item) => push(`assignment:${item.id}`, "assignment", `Assignment deadline: ${item.title}`, `Due ${item.dueDate}.`, item.createdAt, "/assignments"));
    const stats = calculateStudentStats(student.id, db.attendance || []); if (stats.total && stats.percentage < 75) push(`attendance:${student.id}`, "attendance", "Attendance warning", `Your attendance is ${stats.percentage}%.`, new Date().toISOString(), "/history");
    (db.examinations || []).filter((item) => !item.className || item.className === student.className).slice(0, 6).forEach((item) => push(`exam:${item.id}`, "exam", `Exam announcement: ${item.subject}`, `${item.date || "Date to be announced"}${item.room ? ` · Room ${item.room}` : ""}.`, item.createdAt || item.date, "/student"));
    (db.results || []).filter((item) => item.studentId === student.id).sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt))).slice(0, 6).forEach((item) => push(`result:${item.id}`, "result", "Result published", item.subject || "Your academic result is available.", item.publishedAt, "/my-results"));
    // Live QR attendance sessions for this student's class. Computed live
    // from db.attendanceSessions (same source the Attendance Command Center
    // reads) rather than written per-student at session-creation time, since
    // that's how every other notification category here already works - no
    // separate notification-record model to keep in sync. The session's
    // `sequence` is folded into the id so a QR rotation (new qrToken) shows
    // up as a fresh, unread notification instead of reusing a read one that
    // points at an expired token.
    (db.attendanceSessions || []).filter((session) => session.active && new Date(session.endsAt).getTime() > Date.now()).forEach((session) => {
      const subject = (db.subjects || []).find((item) => item.id === session.subjectId);
      if (subject && subject.className === student.className) push(`attendance-session:${session.id}:${session.sequence}`, "attendance", `Live attendance: ${subject.subjectName}`, "A QR attendance session just started. Tap to check in.", session.createdAt, `/attend/${session.id}?t=${session.qrToken}`);
    });
  }
  if (user.role === "teacher") (db.assignments || []).filter((item) => item.teacherId === user.id).slice(0, 8).forEach((item) => push(`faculty-assignment:${item.id}`, "assignment", `Assignment: ${item.title}`, `Class ${item.className} · due ${item.dueDate}.`, item.createdAt, "/faculty/assignments"));
  if (user.role === "admin") { const pending = (db.pendingStudents || []).filter((item) => item.approvalStatus === "pending").length; if (pending) push("security:pending", "security", "Pending student approvals", `${pending} registration request${pending > 1 ? "s" : ""} require review.`, new Date().toISOString(), "/admin"); const inactive = (db.students || []).filter((item) => item.active === false).length; if (inactive) push("security:inactive", "security", "Inactive accounts", `${inactive} student account${inactive > 1 ? "s are" : " is"} inactive.`, new Date().toISOString(), "/admin"); }
  // Profile-photo review. Computed live like every category above: admins see
  // the pending count (folded into the id so a changed count is a fresh,
  // unread notification); a student sees their latest verdict for two weeks.
  if (user.role === "admin") {
    const pendingPhotos = (db.studentPhotos || []).filter((item) => item.status === "pending").length;
    if (pendingPhotos) push(`photo-pending:${pendingPhotos}`, "notice", "Profile photos awaiting review", `${pendingPhotos} photo${pendingPhotos > 1 ? "s" : ""} need approval.`, new Date().toISOString(), "/photo-approvals");
  }
  if (student) {
    const verdict = (db.studentPhotos || [])
      .filter((item) => item.studentId === student.id && ["approved", "rejected"].includes(item.status) && item.reviewedAt && Date.now() - new Date(item.reviewedAt).getTime() < 14 * 86400000)
      .sort((a, b) => String(b.reviewedAt).localeCompare(String(a.reviewedAt)))[0];
    if (verdict) push(`photo:${verdict.id}:${verdict.status}`, "notice", verdict.status === "approved" ? "Profile photo approved" : "Profile photo rejected", verdict.status === "approved" ? "Your new profile photo is now live." : `Reason: ${verdict.rejectionReason || "Not specified."} You can upload a new photo.`, verdict.reviewedAt, "/profile");
  }
  // --- Final-year projects (Phase 4) and fee payments (Phase 7) ----------
  // Extended in place rather than introducing a notification store: every
  // category above is derived live from the domain collections at read
  // time, and a stored-notification model would have to be kept in sync by
  // every route that changes project or payment state.
  const projects = db.projects || [];
  if (student) {
    projects.filter((item) => isProjectMember(item, student.id)).slice(0, 4).forEach((item) => {
      // The id folds in the state being reported, so a later decision shows
      // up as a fresh unread entry instead of reusing a read one.
      if (item.status === "completed") push(`project:${item.id}:completed`, "result", "Project evaluated", `${item.title || "Your final-year project"} was approved${item.finalGrade ? ` with grade ${item.finalGrade}` : ""}.`, item.completedAt || item.updatedAt, "/student");
      else if (item.status === "rejected") push(`project:${item.id}:rejected`, "notice", "Project guide declined", item.remarks || "Propose another guide to continue.", item.updatedAt, "/student");
      else if (item.status === "pending_guide") push(`project:${item.id}:pending_guide`, "notice", "Project awaiting guide response", `${item.title || "Your project"} is waiting for the proposed guide.`, item.updatedAt, "/student");
      (item.milestones || []).filter((milestone) => ["approved", "rejected"].includes(milestone.status) && milestone.reviewedAt).slice(0, 4).forEach((milestone) => {
        push(`project-milestone:${milestone.id}:${milestone.status}`, "assignment", milestone.status === "approved" ? "Milestone approved" : "Milestone needs revision", `${milestone.title || "Milestone"}${milestone.remarks ? ` — ${milestone.remarks}` : "."}`, milestone.reviewedAt, "/student");
      });
    });
    const fee = (db.studentFees || []).find((item) => item.studentId === student.id);
    if (fee) {
      const balance = Math.max(0, Number(fee.amountDue || 0) - Number(fee.amountPaid || 0));
      const overdue = Boolean(fee.dueDate) && fee.dueDate < new Date().toISOString().slice(0, 10);
      // The balance is part of the id so a changed balance (a payment, or an
      // admin adjustment) replaces the old entry rather than staying read.
      if (balance > 0) push(`fee:${student.id}:${balance}`, overdue ? "security" : "notice", overdue ? "Fee payment overdue" : "Fee payment due", `${balance} outstanding${fee.dueDate ? ` · due ${fee.dueDate}` : ""}.`, fee.updatedAt || new Date().toISOString(), "/my-fees");
    }
    (db.payments || []).filter((item) => item.studentId === student.id && item.status === "paid" && item.paidAt && Date.now() - new Date(item.paidAt).getTime() < 30 * 86400000)
      .sort((a, b) => String(b.paidAt).localeCompare(String(a.paidAt))).slice(0, 3)
      .forEach((item) => push(`payment:${item.id}:paid`, "notice", "Fee payment received", `Receipt ${item.receiptNumber || "pending"} · your payment was confirmed.`, item.paidAt, "/my-fees"));
  }
  if (user.role === "teacher") {
    projects.filter((item) => item.guideId === user.id).slice(0, 8).forEach((item) => {
      if (item.status === "pending_guide") push(`guide-request:${item.id}`, "notice", "Guide request", `${item.title || "A project"} has proposed you as its guide.`, item.updatedAt, "/faculty");
      if (item.status === "submitted") push(`guide-review:${item.id}`, "assignment", "Project awaiting final review", `${item.title || "A project"} has submitted its final report.`, item.updatedAt, "/faculty");
      (item.milestones || []).filter((milestone) => milestone.status === "submitted").slice(0, 4).forEach((milestone) => {
        push(`guide-milestone:${milestone.id}`, "assignment", "Milestone awaiting review", `${item.title || "Project"} · ${milestone.title || "Milestone"}.`, milestone.submittedAt || item.updatedAt, "/faculty");
      });
    });
  }
  if (user.role === "admin") {
    const unguided = projects.filter((item) => item.status === "pending_guide").length;
    if (unguided) push(`project-pending:${unguided}`, "notice", "Projects without a guide", `${unguided} project${unguided > 1 ? "s are" : " is"} waiting on a guide response.`, new Date().toISOString(), "/admin");
    const failedPayments = (db.payments || []).filter((item) => item.status === "failed").length;
    if (failedPayments) push(`payment-failed:${failedPayments}`, "security", "Failed fee payments", `${failedPayments} payment attempt${failedPayments > 1 ? "s" : ""} failed and may need follow-up.`, new Date().toISOString(), "/fees");
  }
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
    (db.subjects || []).filter((item) => classes.includes(item.className) && subjectAssignedToTeacher(db, item, user.code)).forEach((item) => add("subject", item.id, item.subjectName, `${item.code} · ${item.className}`, "/schedule"));
    (db.schedules || []).filter((item) => scheduleBelongsToTeacher(item, user.code)).forEach((item) => add("class", item.id, item.subject, `${item.day} · ${item.startTime}-${item.endTime} · ${item.section}`, "/schedule", item.room));
    (db.assignments || []).filter((item) => item.teacherId === user.id).forEach((item) => add("assignment", item.id, item.title, `${item.className} · due ${item.dueDate}`, "/faculty/assignments", item.description));
  } else {
    const student = (db.students || []).find((item) => item.id === user.id); const className = student?.className;
    (db.subjects || []).filter((item) => item.className === className).forEach((item) => add("subject", item.id, item.subjectName, `${item.code} · ${item.teacher}`, "/schedule"));
    (db.teachers || []).forEach((item) => add("faculty", item.id, item.name, item.department, "/teachers", item.email));
    (db.notices || []).filter((item) => student && noticeVisibleToStudent(item, student)).forEach((item) => add("notice", item.id, item.title, item.category || "Notice", "/student", item.body));
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
  const id = String(req.params.id).slice(0, 200);
  const db = await readDb(); db.notificationReads ||= {};
  const current = new Set(Array.isArray(db.notificationReads[req.user.id]) ? db.notificationReads[req.user.id] : []);
  current.add(id);
  db.notificationReads[req.user.id] = [...current].slice(-500); await writeDb(db); res.json({ ok: true });
});

sharedRouter.post("/notifications/read-all", requireAuth, async (req, res) => {
  const db = await readDb(); db.notificationReads ||= {}; db.notificationReads[req.user.id] = buildNotifications(db, req.user).map((item) => item.id).slice(-500); await writeDb(db); res.json({ ok: true });
});

sharedRouter.get("/student/portal", requireAuth, async (req, res) => {
  if (req.user.role !== "student") return res.status(403).json({ message: "Student access required." });
  const db = await readDb();
  ensureCollections(db);
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
    notices: (db.notices || []).filter((item) => noticeVisibleToStudent(item, student)).slice(0, 12),
    notes: (db.notes || []).filter((item) => item.className === student.className).slice(0, 30).map((item) => ({ id: item.id, title: item.title, teacherName: item.teacherName, className: item.className, file: item.file, createdAt: item.createdAt })),
    liveQuizSessions: (db.quizSessions || []).filter((session) => session.active && session.className === student.className && new Date(session.endsAt).getTime() > Date.now()).map((session) => ({ id: session.id, title: session.title, subjectId: session.subjectId, className: session.className, teacherName: session.teacherName, startedAt: session.startedAt, endsAt: session.endsAt, questionCount: (db.quizzes || []).filter((quiz) => quiz.sessionId === session.id && quiz.active).length })),
    fees: (() => {
      const fee = (db.studentFees || []).find((item) => item.studentId === student.id);
      return fee ? publicStudentFee(fee, db) : { status: "not-published", amountDue: 0, dueDate: null };
    })(),
    academics: academicsFor(db, student.id),
    holidays: (db.holidays || []).slice(0, 8)
  });
});

// QR destination for a faculty-led question session. Correct answers are
// never returned to the student client.
sharedRouter.get("/quiz-session/:id", requireAuth, async (req, res) => {
  if (req.user.role !== "student") return res.status(403).json({ message: "Student access required." });
  const db = await readDb();
  const student = (db.students || []).find((item) => item.id === req.user.id);
  const session = (db.quizSessions || []).find((item) => item.id === req.params.id);
  if (!student || !session || session.className !== student.className) return res.status(404).json({ message: "Question session not found for your class." });
  if (!session.active || new Date(session.endsAt).getTime() <= Date.now()) return res.status(400).json({ message: "This question session has ended." });
  const attempts = new Set((db.quizAttempts || []).filter((attempt) => attempt.studentId === student.id).map((attempt) => attempt.quizId));
  const subject = (db.subjects || []).find((item) => item.id === session.subjectId);
  const questions = (db.quizzes || []).filter((quiz) => quiz.sessionId === session.id && quiz.active).map((quiz) => ({ id: quiz.id, question: quiz.question, options: quiz.options, attempted: attempts.has(quiz.id) }));
  res.json({ session: { id: session.id, title: session.title, className: session.className, teacherName: session.teacherName, subjectName: subject?.subjectName || "Subject", startedAt: session.startedAt, endsAt: session.endsAt, questions } });
});

// Download a faculty note's file. Available to: the teacher who uploaded
// it, an admin, or a student in the class the note was published to.
sharedRouter.get("/notes/:id/file", requireAuth, async (req, res) => {
  const db = await readDb();
  const note = (db.notes || []).find((item) => item.id === req.params.id);
  if (!note) return res.status(404).json({ message: "Note not found." });

  const allowed =
    req.user.role === "admin" ||
    (req.user.role === "teacher" && note.teacherId === req.user.id) ||
    (req.user.role === "student" && (db.students || []).some((item) => item.id === req.user.id && item.className === note.className));
  if (!allowed) return res.status(403).json({ message: "You do not have access to this file." });

  // A note row with no file metadata (older record, or a partially failed
  // upload) crashed here on note.file.storedName.
  if (!note.file?.storedName) return res.status(404).json({ message: "File not found." });
  const buffer = await loadFile({ storedName: note.file.storedName, localDir: facultyUploadRoot });
  if (!buffer) return res.status(404).json({ message: "File not found." });
  res.set("Content-Type", note.file.type || "application/octet-stream");
  res.attachment(note.file.name || "note");
  res.send(buffer);
});
// Download a teacher-provided assignment attachment (reference material,
// not a submission). Available to: the teacher who owns the assignment, an
// admin, or any student in the class the assignment was posted to.
sharedRouter.get("/assignments/:id/attachments/:attachmentId", requireAuth, async (req, res) => {
  const db = await readDb();
  const assignment = (db.assignments || []).find((item) => item.id === req.params.id);
  if (!assignment) return res.status(404).json({ message: "Assignment not found." });

  const allowed =
    req.user.role === "admin" ||
    (req.user.role === "teacher" && assignment.teacherId === req.user.id) ||
    (req.user.role === "student" && (db.students || []).some((item) => item.id === req.user.id && item.className === assignment.className));
  if (!allowed) return res.status(403).json({ message: "You do not have access to this file." });

  const attachment = (assignment.attachments || []).find((item) => item.id === req.params.attachmentId);
  if (!attachment) return res.status(404).json({ message: "Attachment not found." });

  const buffer = await loadFile({ storedName: attachment.storedName, localDir: assignmentAttachmentRoot });
  if (!buffer) return res.status(404).json({ message: "File not found." });
  res.set("Content-Type", attachment.type || "application/octet-stream");
  res.attachment(attachment.name || "attachment");
  res.send(buffer);
});

// Compute an urgency status for an assignment relative to now, factoring in
// completion. dueDate can be a plain date ("2026-05-01", treated as
// end-of-day) or a full datetime ("2026-05-01T23:59"). Submissions are never
// blocked past the deadline — a late turn-in is simply marked "late" instead
// of "completed", mirroring Google Classroom rather than locking students out.
function computeAssignmentStatus(dueDate, completion) {
  const due = new Date(dueDate);
  if (!/T\d/.test(String(dueDate))) due.setHours(23, 59, 59, 999);

  if (completion) {
    return new Date(completion.completedAt).getTime() > due.getTime() ? "late" : "completed";
  }

  const msPerDay = 24 * 60 * 60 * 1000;
  // A date-only deadline means the whole calendar day, not midnight at the
  // start of that day. Comparing timestamps made a deadline exactly three
  // calendar days away appear "upcoming" late in the current day.
  if (!/T\d/.test(String(dueDate))) {
    const current = new Date();
    const todayUtc = Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), current.getUTCDate());
    const dueUtc = Date.UTC(due.getFullYear(), due.getMonth(), due.getDate());
    const calendarDays = Math.round((dueUtc - todayUtc) / msPerDay);
    if (calendarDays < 0) return "overdue";
    if (calendarDays <= 3) return "due-soon";
    return "upcoming";
  }
  const diffMs = due.getTime() - Date.now();
  if (diffMs < 0) return "overdue";
  if (diffMs <= 3 * msPerDay) return "due-soon";
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
      return studentAssignmentView(a, completion);
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

  const existingIndex = db.assignmentCompletions.findIndex(
    (c) => c.assignmentId === assignment.id && c.studentId === student.id
  );
  const existing = existingIndex >= 0 ? db.assignmentCompletions[existingIndex] : null;

  // A file submission is treated as final: once one exists, further changes
  // (including text/link edits) must go through the teacher, not this route.
  // Once graded, the submission is locked too, mirroring a "returned" item
  // in Google Classroom. Note there is no deadline check here any more: a
  // student can still turn work in after the due date — computeAssignmentStatus
  // marks it "late" rather than the route blocking it outright.
  if (existing?.submissionFiles?.length) {
    return res.status(409).json({ message: "You have already submitted file(s) for this assignment and cannot make further changes. Contact your teacher if you need to resubmit." });
  }
  if (existing?.evaluatedAt) {
    return res.status(409).json({ message: "This assignment has already been graded. Contact your teacher if you need to resubmit." });
  }

  const { submissionText, submissionLink } = req.body || {};
  let text = "";
  let link = "";

  // requiredText throws past 2000 characters; uncaught that became a 500
  // rather than telling the student their answer is too long.
  if (submissionText) {
    try { text = requiredText(submissionText, "Submission text", { max: 2000 }); }
    catch (error) { return res.status(400).json({ message: error.message }); }
  }
  if (submissionLink) {
    if (typeof submissionLink !== "string" || submissionLink.length > 2000) {
      return res.status(400).json({ message: "Submission link is invalid." });
    }
    link = submissionLink.trim();
    // "http" also matched "httpfoo://" and, worse, any "https://"-prefixed
    // javascript payload was never the issue - but an unparseable URL was
    // stored verbatim and rendered as a link in the teacher's view.
    let parsed;
    try { parsed = new URL(link); } catch { parsed = null; }
    if (!parsed || !["http:", "https:"].includes(parsed.protocol)) {
      return res.status(400).json({ message: "Link must be a valid http:// or https:// URL." });
    }
  }

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

const MAX_SUBMISSION_FILES = 5;

// Accepts one or more files per request; a student can call this endpoint
// again later to add more, up to MAX_SUBMISSION_FILES total (mirrors Google
// Classroom's "Add or create" attachment list rather than a single file).
sharedRouter.post("/student/assignments/:id/submission", requireAuth, completeRateLimit, (req, res, next) => {
  submissionUpload.array("files", MAX_SUBMISSION_FILES)(req, res, (error) => {
    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") return res.status(413).json({ message: "One of the submission files is too large." });
    if (error instanceof multer.MulterError && error.code === "LIMIT_UNEXPECTED_FILE") return res.status(400).json({ message: `You can attach at most ${MAX_SUBMISSION_FILES} files.` });
    if (error || !req.files || req.files.length === 0) return res.status(400).json({ message: "Submit one or more PDF, PNG, or JPEG files." });
    next();
  });
}, async (req, res) => {
  if (req.user.role !== "student") return res.status(403).json({ message: "Student access required." });
  for (const file of req.files) {
    if (!hasValidFileSignature(file)) return res.status(400).json({ message: "One of the uploaded files does not match its declared type." });
  }
  const db = await readDb();
  db.assignments ||= [];
  db.assignmentCompletions ||= [];
  const student = db.students.find((item) => item.id === req.user.id);
  const assignment = db.assignments.find((item) => item.id === req.params.id && item.className === student?.className);
  if (!student || !assignment) return res.status(404).json({ message: "Assignment not found." });

  const existing = db.assignmentCompletions.find((item) => item.assignmentId === assignment.id && item.studentId === student.id);
  if (existing?.evaluatedAt) {
    return res.status(409).json({ message: "This assignment has already been graded. Contact your teacher if you need to resubmit." });
  }
  const existingFiles = existing?.submissionFiles || [];
  if (existingFiles.length + req.files.length > MAX_SUBMISSION_FILES) {
    return res.status(409).json({ message: `You can attach at most ${MAX_SUBMISSION_FILES} files in total.` });
  }

  const savedFiles = [];
  for (const file of req.files) {
    const extension = extensionForMimetype(file.mimetype);
    const storedName = `${crypto.randomUUID()}.${extension}`;
    await saveFile({ storedName, buffer: file.buffer, localDir: uploadRoot });
    savedFiles.push({ name: cleanFileName(file.originalname, "submission"), type: file.mimetype, size: file.size, storedName });
  }

  const completion = existing || { id: makeId("cmp"), assignmentId: assignment.id, studentId: student.id, submissionText: "", submissionLink: "" };
  completion.completedAt = new Date().toISOString();
  completion.submissionFiles = [...existingFiles, ...savedFiles];
  if (!existing) db.assignmentCompletions.push(completion);
  try {
    await writeDb(db);
  } catch (error) {
    await Promise.all(savedFiles.map((file) => deleteFile({ storedName: file.storedName, localDir: uploadRoot }).catch(() => {})));
    throw error;
  }
  res.json({ completed: true, submissionFiles: completion.submissionFiles });
});

// Download one submission file by its stored name. Available to: the
// student who submitted it, the teacher who owns the assignment, or an admin.
sharedRouter.get("/student/assignments/:id/submission/file/:storedName", requireAuth, async (req, res) => {
  const db = await readDb();
  const assignment = (db.assignments || []).find((item) => item.id === req.params.id);
  if (!assignment) return res.status(404).json({ message: "Assignment not found." });

  const targetStudentId = req.user.role === "student" ? req.user.id : String(req.query.studentId || "");
  if (!targetStudentId || targetStudentId.length > 80) return res.status(400).json({ message: "A student is required." });

  const allowed =
    req.user.role === "admin" ||
    (req.user.role === "teacher" && assignment.teacherId === req.user.id) ||
    (req.user.role === "student" && req.user.id === targetStudentId);
  if (!allowed) return res.status(403).json({ message: "You do not have access to this file." });

  const completion = (db.assignmentCompletions || []).find((item) => item.assignmentId === assignment.id && item.studentId === targetStudentId);
  const submissionFile = completion?.submissionFiles?.find((file) => file.storedName === req.params.storedName);
  if (!submissionFile) return res.status(404).json({ message: "No submission file found." });

  const buffer = await loadFile({ storedName: submissionFile.storedName, localDir: uploadRoot });
  if (!buffer) return res.status(404).json({ message: "File not found." });
  res.set("Content-Type", submissionFile.type || "application/octet-stream");
  res.attachment(submissionFile.name || "submission");
  res.send(buffer);
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

  const existing = db.assignmentCompletions.find((c) => c.assignmentId === assignment.id && c.studentId === student.id);
  if (existing?.submissionFiles?.length) {
    return res.status(409).json({ message: "File(s) have already been submitted for this assignment and cannot be withdrawn. Contact your teacher if you need to resubmit." });
  }
  if (existing?.evaluatedAt) {
    return res.status(409).json({ message: "This assignment has already been graded and cannot be withdrawn. Contact your teacher if you need to resubmit." });
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
        subjectId: quiz.subjectId,
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
  // Quiz questions are authoring material, not class-wide directory data.
  // A teacher may retrieve only quizzes they authored; students reach this
  // route through the class check above, and admins retain support access.
  if (req.user.role === "teacher" && quiz.teacherId !== req.user.id) {
    return res.status(404).json({ message: "Quiz not found." });
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

  const { withinRange, distance, radiusMeters } = isWithinCollege(lat, lng, Number(accuracy) || 0);
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
    // Mark present via the shared helper so this goes through the same
    // dedup + audit-trail path as every other attendance-writing route
    // (attendance.js's /mark, /batch, /check-in).
    const result = upsertAttendance(db, { studentId: student.id, subjectId: quiz.subjectId, status: "present", method: "quiz", changedBy: student.id });
    await writeDb(db);
    if (result.duplicatePrevented) {
      return res.json({ correct: true, message: "Correct answer! You were already marked present for today.", attendanceId: result.record.id });
    }
    return res.json({ correct: true, message: "Correct answer! Attendance marked present.", attendanceId: result.record.id });
  } else {
    await writeDb(db);
    return res.json({ correct: false, message: "Incorrect answer. You have used your one attempt; attendance was not marked." });
  }
});
