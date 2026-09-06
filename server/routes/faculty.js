import { Router } from "express";
import { makeId, readDb, writeDb } from "../db/fileStore.js";
import { requireAuth, requireFaculty as requireTeacher } from "../middleware/auth.js";
import { classesTaughtByTeacher, scheduleBelongsToTeacher } from "../services/accessService.js";
import { rateConfig, rateLimit } from "../middleware/rateLimit.js";
import { parseAnswerIndex, requiredText } from "../services/validation.js";

export const facultyRouter = Router();
const quizCreateConfig = rateConfig("FACULTY_QUIZ_CREATE", { windowMs: 5 * 60 * 1000, limit: 30 });

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
      department: stu.department,
      email: stu.email
    }));

  res.json({ students, classes: classesTaught });
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
      submissionLink: completion ? completion.submissionLink : null
    };
  });

  res.json({ submissions });
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
