import { Router } from "express";
import crypto from "node:crypto";
import multer from "multer";
import { makeId, readDb, writeDb } from "../db/fileStore.js";
import { deleteFile, loadFile, saveFile } from "../db/blobStore.js";
import { requireAuth, requireFaculty as requireTeacher } from "../middleware/auth.js";
import { classesTaughtByTeacher, scheduleBelongsToTeacher, subjectAssignedToTeacher } from "../services/accessService.js";
import { rateConfig, rateLimit } from "../middleware/rateLimit.js";
import { calculateStudentStats, facultyStudent, publicStudent } from "../services/attendanceService.js";
import { parseAnswerIndex, requiredText, validateKeys } from "../services/validation.js";
import { cleanFileName, extensionForMimetype, hasValidFileSignature, uploadFileFilter } from "../services/uploadValidation.js";
import { resolveUploadRoot } from "../utils/uploadRoot.js";
import { collectAttachmentBlobs, collectSubmissionBlobs, deleteAssignmentBlobs } from "../services/assignmentService.js";

export const facultyRouter = Router();
const quizCreateConfig = rateConfig("FACULTY_QUIZ_CREATE", { windowMs: 5 * 60 * 1000, limit: 30 });
const facultyUploadRoot = resolveUploadRoot("faculty-notes");
// Same path shared.js resolves for its attachment-download route — keep
// these two constants in sync since they must point at the same folder.
const assignmentAttachmentRoot = resolveUploadRoot("assignment-attachments");
const noteUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: Number(process.env.SUBMISSION_MAX_BYTES) || 5 * 1024 * 1024 }, fileFilter: uploadFileFilter });
function teacherScope(db, user) { const classes = classesTaughtByTeacher(db, user.code); return { classes, subjects: (db.subjects || []).filter((subject) => classes.includes(subject.className) && subjectAssignedToTeacher(db, subject, user.code)), students: (db.students || []).filter((student) => classes.includes(student.className)) }; }

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
  const department = (db.departments || []).find((item) => item.name === (db.teachers || []).find((teacher) => teacher.id === req.user.id)?.department);
  res.json({ classes: scope.classes, subjects: scope.subjects, schedule: (db.schedules || []).filter((item) => scheduleBelongsToTeacher(item, req.user.code)).sort((a, b) => a.day.localeCompare(b.day) || a.period - b.period), students: scope.students.map((student) => ({ ...facultyStudent(student, attendance), attendance: calculateStudentStats(student.id, attendance) })), assignments: (db.assignments || []).filter((item) => item.teacherId === req.user.id), notices: (db.notices || []).filter((item) => item.teacherId === req.user.id || (department && item.departmentId === department.id)), notes: (db.notes || []).filter((item) => item.teacherId === req.user.id), marks: (db.internalMarks || []).filter((item) => scope.students.some((student) => student.id === item.studentId) && scope.subjects.some((subject) => subject.id === item.subjectId)), holidays: db.holidays || [] });
});

facultyRouter.get("/marks", requireAuth, requireTeacher, async (req, res) => {
  const db = await readDb(); const scope = teacherScope(db, req.user);
  res.json({ marks: (db.internalMarks || []).filter((item) => scope.students.some((student) => student.id === item.studentId) && scope.subjects.some((subject) => subject.id === item.subjectId)), students: scope.students, subjects: scope.subjects });
});

// Retired: marks are now entered per subject on the mark sheet (/api/marks/sheet/:subjectId),
// which adds end-semester marks, grades and the draft -> published -> locked workflow. Leaving
// two writers on db.internalMarks would let this endpoint edit rows on a published sheet.
facultyRouter.put("/marks", requireAuth, requireTeacher, (_req, res) => {
  res.status(410).json({ message: "Marks entry has moved to Marks & Results." });
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
  if (!hasValidFileSignature(req.file)) return res.status(400).json({ message: "The uploaded note content does not match its declared type." });
  const db = await readDb(); const scope = teacherScope(db, req.user); const className = String(req.body.className || ""); if (!className || !scope.classes.includes(className)) return res.status(403).json({ message: "You can only upload notes for your classes." });
  const extension = extensionForMimetype(req.file.mimetype); const storedName = `${crypto.randomUUID()}.${extension}`; await saveFile({ storedName, buffer: req.file.buffer, localDir: facultyUploadRoot });
  db.notes ||= []; const note = { id: crypto.randomUUID(), title: String((typeof req.body.title === "string" && req.body.title.trim()) || req.file.originalname).slice(0, 160), className, teacherId: req.user.id, teacherName: req.user.name, file: { name: cleanFileName(req.file.originalname, "note"), type: req.file.mimetype, size: req.file.size, storedName }, createdAt: new Date().toISOString() }; db.notes.unshift(note); try { await writeDb(db); } catch (error) { await deleteFile({ storedName, localDir: facultyUploadRoot }).catch(() => {}); throw error; } res.status(201).json({ note });
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
  if (typeof className !== "string" || !className.trim() || typeof dueDate !== "string" || !dueDate.trim()) {
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
  if (typeof className !== "string" || !className.trim() || typeof dueDate !== "string" || !dueDate.trim()) {
    return res.status(400).json({ message: "className and dueDate are required." });
  }
  if (Number.isNaN(new Date(dueDate).getTime())) {
    return res.status(400).json({ message: "dueDate must be a valid date." });
  }
  const classesTaught = classesTaughtByTeacher(db, req.user.code);
  if (!classesTaught.includes(className)) {
    return res.status(403).json({ message: "You can only assign this to classes you teach." });
  }
  // Both the teacher's own submissions view and the student's assignment
  // list filter strictly by the assignment's *current* className, so
  // changing it after students have submitted makes their work (text,
  // links, and uploaded files) silently unreachable through the UI/API —
  // it isn't deleted, just orphaned. Block the change instead, the same way
  // subjects.js blocks a className edit once marks exist for that subject.
  db.assignmentCompletions ||= [];
  if (className !== assignment.className && db.assignmentCompletions.some((item) => item.assignmentId === assignment.id)) {
    return res.status(409).json({ message: "Students have already submitted work for this assignment. Delete or move their submissions before changing the class." });
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
  const assignment = (db.assignments || []).find((item) => item.id === req.params.id && item.teacherId === req.user.id);
  if (!assignment) return res.status(404).json({ message: "Assignment not found." });
  const completionsForAssignment = (db.assignmentCompletions || []).filter((item) => item.assignmentId === assignment.id);
  // Collect every blob this assignment owns — its own reference attachments
  // and every student's submitted files — before the records pointing at
  // them are removed below, mirroring projects.js's deleteProjectBlobs.
  const attachmentStoredNames = collectAttachmentBlobs(assignment);
  const submissionStoredNames = collectSubmissionBlobs(completionsForAssignment);
  db.assignments = (db.assignments || []).filter((item) => item.id !== assignment.id);
  // Submissions were left behind, so re-using the id (or an admin report that
  // counts completions) still saw rows for an assignment that no longer exists.
  db.assignmentCompletions = (db.assignmentCompletions || []).filter((item) => item.assignmentId !== assignment.id);
  await writeDb(db);
  await deleteAssignmentBlobs({ attachmentStoredNames, submissionStoredNames });
  res.json({ ok: true });
});

const MAX_ASSIGNMENT_ATTACHMENTS = 5;

// Reference material the teacher posts alongside the assignment (a question
// paper, a rubric, sample data, etc.) — separate from what students submit.
facultyRouter.post("/assignments/:id/attachments", requireAuth, requireTeacher, (req, res, next) => noteUpload.array("files", MAX_ASSIGNMENT_ATTACHMENTS)(req, res, (error) => {
  if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") return res.status(413).json({ message: "One of the attachment files is too large." });
  if (error instanceof multer.MulterError && error.code === "LIMIT_UNEXPECTED_FILE") return res.status(400).json({ message: `You can attach at most ${MAX_ASSIGNMENT_ATTACHMENTS} files.` });
  if (error || !req.files || req.files.length === 0) return res.status(400).json({ message: "Attach one or more PDF, PNG, or JPEG files." });
  next();
}), async (req, res) => {
  for (const file of req.files) {
    if (!hasValidFileSignature(file)) return res.status(400).json({ message: "One of the uploaded files does not match its declared type." });
  }
  const db = await readDb();
  db.assignments ||= [];
  const assignment = db.assignments.find((item) => item.id === req.params.id && item.teacherId === req.user.id);
  if (!assignment) return res.status(404).json({ message: "Assignment not found." });
  assignment.attachments ||= [];
  if (assignment.attachments.length + req.files.length > MAX_ASSIGNMENT_ATTACHMENTS) {
    return res.status(409).json({ message: `You can attach at most ${MAX_ASSIGNMENT_ATTACHMENTS} reference files per assignment.` });
  }
  for (const file of req.files) {
    const extension = extensionForMimetype(file.mimetype);
    const storedName = `${crypto.randomUUID()}.${extension}`;
    await saveFile({ storedName, buffer: file.buffer, localDir: assignmentAttachmentRoot });
    assignment.attachments.push({ id: makeId("att"), name: cleanFileName(file.originalname, "assignment-attachment"), type: file.mimetype, size: file.size, storedName });
  }
  await writeDb(db);
  res.status(201).json({ assignment });
});

facultyRouter.delete("/assignments/:id/attachments/:attachmentId", requireAuth, requireTeacher, async (req, res) => {
  const db = await readDb();
  db.assignments ||= [];
  const assignment = db.assignments.find((item) => item.id === req.params.id && item.teacherId === req.user.id);
  if (!assignment) return res.status(404).json({ message: "Assignment not found." });
  const removedAttachment = (assignment.attachments || []).find((item) => item.id === req.params.attachmentId);
  assignment.attachments = (assignment.attachments || []).filter((item) => item.id !== req.params.attachmentId);
  await writeDb(db);
  await deleteAssignmentBlobs({ attachmentStoredNames: collectAttachmentBlobs({ attachments: removedAttachment ? [removedAttachment] : [] }) });
  res.json({ assignment });
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
      submissionFiles: completion ? (completion.submissionFiles || []) : [],
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
  if (!subject || subject.className !== className || !subjectAssignedToTeacher(db, subject, req.user.code)) {
    return res.status(400).json({ message: "Subject not found for the selected class." });
  }
  
  // requiredText throws on an over-long question or option. Uncaught, that
  // surfaced as a 500 instead of a 400 telling the teacher what to shorten.
  let safeQuestion, safeOptions;
  try {
    safeQuestion = requiredText(question, "Question", { max: 500 });
    safeOptions = options.map((option) => requiredText(option, "Quiz option", { max: 300 }));
  } catch (error) { return res.status(400).json({ message: error.message }); }

  const quiz = {
    id: makeId("quiz"),
    teacherId: req.user.id,
    question: safeQuestion,
    options: safeOptions,
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
  const quiz = (db.quizzes || []).find((item) => item.id === req.params.id && item.teacherId === req.user.id);
  if (!quiz) return res.status(404).json({ message: "Quiz not found." });
  db.quizzes = (db.quizzes || []).filter((item) => item.id !== quiz.id);
  db.quizAttempts = (db.quizAttempts || []).filter((item) => item.quizId !== quiz.id);
  await writeDb(db);
  res.json({ ok: true });
});

// Live question sessions: one desktop QR can open a session containing one or
// more attendance questions. The existing quiz endpoints remain supported.
facultyRouter.get("/quiz-sessions", requireAuth, requireTeacher, async (req, res) => {
  const db = await readDb();
  db.quizSessions ||= [];
  db.quizzes ||= [];
  const sessions = db.quizSessions.filter((session) => session.teacherId === req.user.id).map((session) => ({
    ...session,
    questions: db.quizzes.filter((quiz) => quiz.sessionId === session.id).map(({ correctAnswerIndex, ...quiz }) => quiz)
  }));
  res.json({ sessions });
});

facultyRouter.post("/quiz-sessions", requireAuth, requireTeacher, rateLimit({ ...quizCreateConfig, message: "Too many session requests. Please try again later." }), async (req, res) => {
  const { className, subjectId, title, durationMinutes = 30 } = req.body || {};
  const db = await readDb();
  const classesTaught = classesTaughtByTeacher(db, req.user.code);
  const subject = (db.subjects || []).find((item) => item.id === subjectId);
  if (!className || !subject || subject.className !== className || !classesTaught.includes(className) || !subjectAssignedToTeacher(db, subject, req.user.code)) return res.status(403).json({ message: "You can only start sessions for classes and subjects you teach." });
  db.quizSessions ||= [];
  const now = new Date();
  const session = { id: makeId("qsession"), teacherId: req.user.id, teacherName: req.user.name, className, subjectId, title: String(title || `${subject.subjectName} attendance session`).slice(0, 160), active: true, startedAt: now.toISOString(), endsAt: new Date(now.getTime() + Math.min(Math.max(Number(durationMinutes) || 30, 5), 180) * 60000).toISOString(), createdAt: now.toISOString() };
  db.quizSessions.unshift(session);
  await writeDb(db);
  res.status(201).json({ session: { ...session, questions: [], qrPath: `/student/quiz-session/${session.id}` } });
});

facultyRouter.post("/quiz-sessions/:id/questions", requireAuth, requireTeacher, async (req, res) => {
  const { question, options, correctAnswerIndex } = req.body || {};
  const db = await readDb();
  const session = (db.quizSessions || []).find((item) => item.id === req.params.id && item.teacherId === req.user.id);
  if (!session) return res.status(404).json({ message: "Question session not found." });
  if (!session.active) return res.status(409).json({ message: "This session is closed." });
  if (!question || !Array.isArray(options) || options.length < 2 || options.length > 6 || options.some((option) => !String(option).trim())) return res.status(400).json({ message: "A question with two to six options is required." });
  const safeCorrectAnswerIndex = parseAnswerIndex(correctAnswerIndex, options.length);
  if (safeCorrectAnswerIndex === null) return res.status(400).json({ message: "correctAnswerIndex must point to a valid option." });
  db.quizzes ||= [];
  let safeQuestion, safeOptions;
  try {
    safeQuestion = requiredText(question, "Question", { max: 500 });
    safeOptions = options.map((option) => requiredText(option, "Quiz option", { max: 300 }));
  } catch (error) { return res.status(400).json({ message: error.message }); }
  const quiz = { id: makeId("quiz"), sessionId: session.id, teacherId: req.user.id, question: safeQuestion, options: safeOptions, correctAnswerIndex: safeCorrectAnswerIndex, className: session.className, subjectId: session.subjectId, active: true, createdAt: new Date().toISOString() };
  db.quizzes.push(quiz);
  await writeDb(db);
  const { correctAnswerIndex: _hidden, ...safeQuiz } = quiz;
  res.status(201).json({ quiz: safeQuiz });
});

facultyRouter.put("/quiz-sessions/:id/toggle", requireAuth, requireTeacher, async (req, res) => {
  const db = await readDb();
  const session = (db.quizSessions || []).find((item) => item.id === req.params.id && item.teacherId === req.user.id);
  if (!session) return res.status(404).json({ message: "Question session not found." });
  session.active = !session.active;
  await writeDb(db);
  res.json({ session });
});
