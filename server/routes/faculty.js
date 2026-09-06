import { Router } from "express";
import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import multer from "multer";
import { makeId, readDb, writeDb } from "../db/fileStore.js";
import { requireAuth, requireFaculty as requireTeacher } from "../middleware/auth.js";
import { classesTaughtByTeacher, scheduleBelongsToTeacher } from "../services/accessService.js";
import { rateConfig, rateLimit } from "../middleware/rateLimit.js";
import { calculateStudentStats, facultyStudent, publicStudent } from "../services/attendanceService.js";
import { parseAnswerIndex, requiredText, validateKeys } from "../services/validation.js";

export const facultyRouter = Router();
const quizCreateConfig = rateConfig("FACULTY_QUIZ_CREATE", { windowMs: 5 * 60 * 1000, limit: 30 });
const facultyUploadRoot = path.resolve(process.env.UPLOAD_DIR || path.join(process.cwd(), "storage", "faculty-notes"));
const noteUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: Number(process.env.SUBMISSION_MAX_BYTES) || 5 * 1024 * 1024 }, fileFilter: (_req, file, callback) => { const extensions = { "application/pdf": ".pdf", "image/png": ".png", "image/jpeg": ".jpg" }; const name = path.extname(file.originalname || "").toLowerCase(); callback(null, extensions[file.mimetype] === name || (file.mimetype === "image/jpeg" && name === ".jpeg")); } });
function validNoteMagic(file) { const h = file.buffer.subarray(0, 8); return (file.mimetype === "application/pdf" && h.toString("ascii", 0, 5) === "%PDF-") || (file.mimetype === "image/png" && h.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) || (file.mimetype === "image/jpeg" && h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff); }
function teacherScope(db, user) { const classes = classesTaughtByTeacher(db, user.code); return { classes, subjects: (db.subjects || []).filter((subject) => classes.includes(subject.className) && String(subject.teacher || "").toLowerCase().includes(String(user.code || "").toLowerCase())), students: (db.students || []).filter((student) => classes.includes(student.className)) }; }

// 1. Get schedule for logged-in teacher
facultyRouter.get("/schedule", requireAuth, requireTeacher, async (req, res) => {
  const db = await readDb();
  db.schedules ||= [];
  const teacherCode = req.user.code;
  const teacherSchedules = db.schedules.filter((sch) => scheduleBelongsToTeacher(sch, teacherCode));
  res.json({ schedules: teacherSchedules });
});

// 2. Get students in classes taught by the teacher
facultyRouter.get("/students", requireAuth, requireTeacher, async (req, res) => {
  const db = await readDb();
  db.schedules ||= [];
  db.students ||= [];
  const teacherCode = req.user.code;
  const classesTaught = classesTaughtByTeacher(db, teacherCode);
  
  const students = db.students
    .filter((stu) => classesTaught.includes(stu.className))
    .map(stu => ({
      id: stu.id,
      name: stu.name,
      rollNumber: stu.rollNumber,
      className: stu.className,
      department: stu.department
    }));

  res.json({ students, classes: classesTaught });
});

facultyRouter.get("/portal", requireAuth, requireTeacher, async (req, res) => {
  const db = await readDb(); const scope = teacherScope(db, req.user); const attendance = db.attendance || [];
  res.json({ classes: scope.classes, subjects: scope.subjects, schedule: (db.schedules || []).filter((item) => scheduleBelongsToTeacher(item, req.user.code)).sort((a, b) => a.day.localeCompare(b.day) || a.period - b.period), students: scope.students.map((student) => ({ ...facultyStudent(student, attendance), attendance: calculateStudentStats(student.id, attendance) })), assignments: (db.assignments || []).filter((item) => item.teacherId === req.user.id), notices: (db.notices || []).filter((item) => item.teacherId === req.user.id), notes: (db.notes || []).filter((item) => item.teacherId === req.user.id), marks: (db.internalMarks || []).filter((item) => scope.students.some((student) => student.id === item.studentId) && scope.subjects.some((subject) => subject.id === item.subjectId)), holidays: db.holidays || [] });
});

facultyRouter.get("/marks", requireAuth, requireTeacher, async (req, res) => {
  const db = await readDb(); const scope = teacherScope(db, req.user);
  res.json({ marks: (db.internalMarks || []).filter((item) => scope.students.some((student) => student.id === item.studentId) && scope.subjects.some((subject) => subject.id === item.subjectId)), students: scope.students, subjects: scope.subjects });
});

facultyRouter.put("/marks", requireAuth, requireTeacher, async (req, res) => {
  try { validateKeys(req.body || {}, ["studentId", "subjectId", "marks", "maxMarks", "remarks"]); } catch { return res.status(400).json({ message: "Invalid marks data." }); }
  const db = await readDb(); const scope = teacherScope(db, req.user); const student = scope.students.find((item) => item.id === req.body.studentId); const subject = scope.subjects.find((item) => item.id === req.body.subjectId); const marks = Number(req.body.marks); const maxMarks = Number(req.body.maxMarks || 100);
  if (!student || !subject || !Number.isFinite(marks) || !Number.isFinite(maxMarks) || maxMarks <= 0 || marks < 0 || marks > maxMarks) return res.status(400).json({ message: "Student, subject, and marks are invalid." });
  if (req.body.remarks !== undefined && (typeof req.body.remarks !== "string" || req.body.remarks.length > 500)) return res.status(400).json({ message: "Remarks are invalid." });
  db.internalMarks ||= []; let record = db.internalMarks.find((item) => item.studentId === student.id && item.subjectId === subject.id); if (!record) { record = { id: crypto.randomUUID(), studentId: student.id, subjectId: subject.id }; db.internalMarks.push(record); }
  Object.assign(record, { marks, maxMarks, remarks: String(req.body.remarks || "").trim(), teacherId: req.user.id, updatedAt: new Date().toISOString() }); await writeDb(db); res.json({ mark: record });
});

facultyRouter.get("/notices", requireAuth, requireTeacher, async (req, res) => { const db = await readDb(); res.json({ notices: (db.notices || []).filter((item) => item.teacherId === req.user.id) }); });

facultyRouter.post("/notices", requireAuth, requireTeacher, async (req, res) => {
  try { validateKeys(req.body || {}, ["title", "body", "category", "className"]); } catch { return res.status(400).json({ message: "Invalid notice data." }); }
  const db = await readDb(); const scope = teacherScope(db, req.user); let title, body;
  try { title = requiredText(req.body.title, "Title", { max: 160 }); body = requiredText(req.body.body, "Notice body", { max: 3000 }); } catch { return res.status(400).json({ message: "Notice title and body are required." }); }
  const className = req.body.className ? String(req.body.className) : ""; if (className && !scope.classes.includes(className)) return res.status(403).json({ message: "You can only publish notices for your classes." });
  db.notices ||= []; const notice = { id: crypto.randomUUID(), title, body, category: ["academic", "exam", "event", "emergency"].includes(req.body.category) ? req.body.category : "academic", className, teacherId: req.user.id, teacherName: req.user.name, createdAt: new Date().toISOString() }; db.notices.unshift(notice); await writeDb(db); res.status(201).json({ notice });
});

facultyRouter.post("/notes", requireAuth, requireTeacher, (req, res, next) => noteUpload.single("file")(req, res, (error) => { if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") return res.status(413).json({ message: "Note file is too large." }); if (error || !req.file) return res.status(400).json({ message: "Submit one PDF, PNG, or JPEG note file." }); next(); }), async (req, res) => {
  if (!validNoteMagic(req.file)) return res.status(400).json({ message: "The uploaded note content does not match its declared type." });
  const db = await readDb(); const scope = teacherScope(db, req.user); const className = String(req.body.className || ""); if (!className || !scope.classes.includes(className)) return res.status(403).json({ message: "You can only upload notes for your classes." });
  await fs.mkdir(facultyUploadRoot, { recursive: true, mode: 0o700 }); const extension = req.file.mimetype === "application/pdf" ? "pdf" : req.file.mimetype === "image/png" ? "png" : "jpg"; const storedName = `${crypto.randomUUID()}.${extension}`; await fs.writeFile(path.join(facultyUploadRoot, storedName), req.file.buffer, { mode: 0o600 });
  db.notes ||= []; const note = { id: crypto.randomUUID(), title: String(req.body.title || req.file.originalname).slice(0, 160), className, teacherId: req.user.id, teacherName: req.user.name, file: { name: req.file.originalname.slice(0, 120), type: req.file.mimetype, size: req.file.size, storedName }, createdAt: new Date().toISOString() }; db.notes.unshift(note); await writeDb(db); res.status(201).json({ note });
});

// 3. Assignments
facultyRouter.get("/assignments", requireAuth, requireTeacher, async (req, res) => {
  const db = await readDb();
  db.assignments ||= [];
  const assignments = db.assignments.filter(a => a.teacherId === req.user.id);
  res.json({ assignments });
});

facultyRouter.post("/assignments", requireAuth, requireTeacher, async (req, res) => {
  const db = await readDb();
  db.assignments ||= [];
  const { title, description, className, dueDate } = req.body;
  let safeTitle, safeDescription;
  try {
    safeTitle = requiredText(title, "Title", { max: 160 });
    safeDescription = description ? requiredText(description, "Description", { max: 2000 }) : "";
  } catch (err) {
    console.warn("Assignment validation failed", err);
    return res.status(400).json({ message: "Invalid assignment details." });
  }
  if (!className || !dueDate) {
    return res.status(400).json({ message: "className and dueDate are required." });
  }
  if (Number.isNaN(new Date(dueDate).getTime())) {
    return res.status(400).json({ message: "dueDate must be a valid date." });
  }
  const classesTaught = classesTaughtByTeacher(db, req.user.code);
  if (!classesTaught.includes(className)) {
    return res.status(403).json({ message: "You can only create assignments for classes you teach." });
  }
  
  const assignment = {
    id: makeId("asg"),
    title: safeTitle,
    description: safeDescription,
    className,
    dueDate,
    teacherId: req.user.id,
    teacherName: req.user.name,
    createdAt: new Date().toISOString()
  };
  
  db.assignments.push(assignment);
  await writeDb(db);
  res.status(201).json({ assignment });
});

facultyRouter.put("/assignments/:id", requireAuth, requireTeacher, async (req, res) => {
  const db = await readDb();
  db.assignments ||= [];
  
  const assignment = db.assignments.find(a => a.id === req.params.id && a.teacherId === req.user.id);
  if (!assignment) return res.status(404).json({ message: "Assignment not found." });

  const { title, description, className, dueDate } = req.body;
  let safeTitle, safeDescription;
  try {
    safeTitle = requiredText(title, "Title", { max: 160 });
    safeDescription = description ? requiredText(description, "Description", { max: 2000 }) : "";
  } catch (err) {
    console.warn("Assignment validation failed", err);
    return res.status(400).json({ message: "Invalid assignment details." });
  }
  if (!className || !dueDate) {
    return res.status(400).json({ message: "className and dueDate are required." });
  }
  if (Number.isNaN(new Date(dueDate).getTime())) {
    return res.status(400).json({ message: "dueDate must be a valid date." });
  }
  const classesTaught = classesTaughtByTeacher(db, req.user.code);
  if (!classesTaught.includes(className)) {
    return res.status(403).json({ message: "You can only assign this to classes you teach." });
  }

  assignment.title = safeTitle;
  assignment.description = safeDescription;
  assignment.className = className;
  assignment.dueDate = dueDate;

  await writeDb(db);
  res.json({ assignment });
});

facultyRouter.delete("/assignments/:id", requireAuth, requireTeacher, async (req, res) => {
  const db = await readDb();
  db.assignments = (db.assignments || []).filter((item) => item.id !== req.params.id || item.teacherId !== req.user.id);
  await writeDb(db);
  res.json({ ok: true });
});

facultyRouter.get("/assignments/:id/submissions", requireAuth, requireTeacher, async (req, res) => {
  const db = await readDb();
  db.assignments ||= [];
  db.students ||= [];
  db.assignmentCompletions ||= [];

  const assignment = db.assignments.find(a => a.id === req.params.id && a.teacherId === req.user.id);
  if (!assignment) return res.status(404).json({ message: "Assignment not found." });

  const classStudents = db.students.filter(s => s.className === assignment.className);
  
  const submissions = classStudents.map(student => {
    const completion = db.assignmentCompletions.find(c => c.assignmentId === assignment.id && c.studentId === student.id);
    return {
      id: student.id,
      name: student.name,
      rollNumber: student.rollNumber,
      completed: !!completion,
      completedAt: completion ? completion.completedAt : null,
      submissionText: completion ? completion.submissionText : null,
      submissionLink: completion ? completion.submissionLink : null,
      submissionFile: completion ? completion.submissionFile : null,
      marks: completion?.marks ?? null,
      maxMarks: completion?.maxMarks ?? null,
      feedback: completion?.feedback || "",
      evaluatedAt: completion?.evaluatedAt || null
    };
  });

  res.json({ submissions });
});

facultyRouter.put("/assignments/:id/submissions/:studentId", requireAuth, requireTeacher, async (req, res) => {
  try { validateKeys(req.body || {}, ["marks", "maxMarks", "feedback"]); } catch { return res.status(400).json({ message: "Invalid evaluation data." }); }
  const db = await readDb(); db.assignments ||= []; db.assignmentCompletions ||= []; db.students ||= [];
  const assignment = db.assignments.find((item) => item.id === req.params.id && item.teacherId === req.user.id); const student = db.students.find((item) => item.id === req.params.studentId && item.className === assignment?.className);
  const marks = Number(req.body.marks); const maxMarks = Number(req.body.maxMarks || 100);
  if (!assignment || !student || !Number.isFinite(marks) || !Number.isFinite(maxMarks) || maxMarks <= 0 || marks < 0 || marks > maxMarks || (req.body.feedback !== undefined && (typeof req.body.feedback !== "string" || req.body.feedback.length > 1000))) return res.status(400).json({ message: "Assignment, student, and evaluation values are invalid." });
  const completion = db.assignmentCompletions.find((item) => item.assignmentId === assignment.id && item.studentId === student.id);
  if (!completion) return res.status(404).json({ message: "The student has not submitted this assignment." });
  Object.assign(completion, { marks, maxMarks, feedback: String(req.body.feedback || "").trim(), evaluatedAt: new Date().toISOString(), evaluatedBy: req.user.id }); await writeDb(db); res.json({ submission: completion });
});

// 4. Quizzes (for QR Attendance)
facultyRouter.get("/quizzes", requireAuth, requireTeacher, async (req, res) => {
  const db = await readDb();
  db.quizzes ||= [];
  const quizzes = db.quizzes.filter(q => q.teacherId === req.user.id);
  res.json({ quizzes });
});

facultyRouter.post("/quizzes", requireAuth, requireTeacher, rateLimit({
  ...quizCreateConfig,
  message: "Too many quiz requests. Please try again later."
}), async (req, res) => {
  const db = await readDb();
  db.quizzes ||= [];
  const { question, options, correctAnswerIndex, className, subjectId } = req.body;
  if (!question || !Array.isArray(options) || options.length < 2 || options.length > 6 ||
      options.some((option) => !String(option).trim()) || correctAnswerIndex === undefined || !className || !subjectId) {
    return res.status(400).json({ message: "Valid question, options, correctAnswerIndex, className, and subjectId are required." });
  }
  const safeCorrectAnswerIndex = parseAnswerIndex(correctAnswerIndex, options.length);
  if (safeCorrectAnswerIndex === null) {
    return res.status(400).json({ message: "correctAnswerIndex must point to a valid option." });
  }

  // A teacher must only be able to grant attendance for classes/subjects they
  // actually teach - without this, any teacher account could create a quiz
  // for someone else's class and mark those students present.
  const classesTaught = classesTaughtByTeacher(db, req.user.code);
  if (!classesTaught.includes(className)) {
    return res.status(403).json({ message: "You can only create attendance questions for classes you teach." });
  }
  const subject = (db.subjects || []).find((item) => item.id === subjectId);
  if (!subject || subject.className !== className) {
    return res.status(400).json({ message: "Subject not found for the selected class." });
  }
  
  const quiz = {
    id: makeId("quiz"),
    teacherId: req.user.id,
    question: requiredText(question, "Question", { max: 500 }),
    options: options.map((option) => requiredText(option, "Quiz option", { max: 300 })),
    correctAnswerIndex: safeCorrectAnswerIndex,
    className,
    subjectId,
    active: true,
    createdAt: new Date().toISOString()
  };
  
  db.quizzes.push(quiz);
  await writeDb(db);
  res.status(201).json({ quiz });
});

facultyRouter.put("/quizzes/:id/toggle", requireAuth, requireTeacher, async (req, res) => {
  const db = await readDb();
  const quiz = (db.quizzes || []).find(q => q.id === req.params.id && q.teacherId === req.user.id);
  if (!quiz) return res.status(404).json({ message: "Quiz not found." });
  
  quiz.active = !quiz.active;
  await writeDb(db);
  res.json({ quiz });
});

facultyRouter.delete("/quizzes/:id", requireAuth, requireTeacher, async (req, res) => {
  const db = await readDb();
  db.quizzes = (db.quizzes || []).filter((item) => item.id !== req.params.id || item.teacherId !== req.user.id);
  await writeDb(db);
  res.json({ ok: true });
});
