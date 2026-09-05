import { Router } from "express";
import { makeId, readDb, writeDb } from "../db/fileStore.js";
import { requireAuth } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { parseAnswerIndex, requiredText } from "../services/validation.js";

export const sharedRouter = Router();

// 1. Get year schedule (holidays) - open to any authenticated user
sharedRouter.get("/holidays", requireAuth, async (req, res) => {
  const db = await readDb();
  res.json({ holidays: db.holidays || [] });
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
  windowMs: 5 * 60 * 1000,
  limit: 20,
  message: "Too many completion toggles. Please try again later."
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
  windowMs: 5 * 60 * 1000,
  limit: 10,
  message: "Too many quiz submissions. Please try again later."
}), async (req, res) => {
  if (req.user.role !== "student") return res.status(403).json({ message: "Student access required." });
  
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
