import { Router } from "express";
import { makeId, readDb, writeDb } from "../db/fileStore.js";
import { requireAdmin, requireAuth } from "../middleware/auth.js";
import { findSheet, parseCredits, parseSemester } from "../services/marksService.js";
import { enumValue, requiredText, validateKeys, validId, validTime } from "../services/validation.js";
import { classesTaughtByTeacher, subjectAssignedToTeacher } from "../services/accessService.js";

export const subjectsRouter = Router();

const SUBJECT_FIELDS = ["subjectName", "code", "teacher", "className", "schedule", "room", "department", "semester", "credits"];
const SUBJECT_TEXT_FIELDS = [["subjectName", 120], ["code", 30], ["teacher", 120], ["className", 80], ["schedule", 120], ["room", 40], ["department", 120]];

subjectsRouter.get("/", requireAuth, async (req, res) => {
  const db = await readDb();
  if (req.user.role === "admin") return res.json({ subjects: db.subjects, classes: db.classes });
  const student = req.user.role === "student" ? (db.students || []).find((item) => item.id === req.user.id) : null;
  const allowedClasses = req.user.role === "teacher" ? new Set(classesTaughtByTeacher(db, req.user.code)) : new Set(student?.className ? [student.className] : []);
  const subjects = (db.subjects || []).filter((item) => allowedClasses.has(item.className) && (req.user.role !== "teacher" || subjectAssignedToTeacher(db, item, req.user.code)));
  const subjectIds = new Set(subjects.map((item) => item.id));
  res.json({ subjects, classes: (db.classes || []).filter((item) => subjectIds.has(item.subjectId)) });
});

subjectsRouter.post("/", requireAuth, requireAdmin, async (req, res) => {
  const db = await readDb();
  try { validateKeys(req.body || {}, SUBJECT_FIELDS); } catch { return res.status(400).json({ message: "Invalid subject data." }); }
  let subjectName, code, teacher, className;
  try {
    subjectName = requiredText(req.body.subjectName, "Subject name", { max: 120 });
    code = requiredText(req.body.code, "Code", { max: 30 });
    teacher = requiredText(req.body.teacher, "Teacher", { max: 120 });
    className = requiredText(req.body.className, "Class", { max: 80 });
  } catch { return res.status(400).json({ message: "Invalid subject data." }); }
  // These two were validated outside the try/catch above, so an over-long or
  // non-string department/semester threw and became a 500 instead of a 400.
  let department, semester, schedule, room, credits;
  try {
    department = req.body.department === undefined ? "" : requiredText(req.body.department, "Department", { min: 0, max: 120 });
    semester = parseSemester(req.body.semester);
    credits = parseCredits(req.body.credits);
    schedule = req.body.schedule === undefined ? "" : requiredText(req.body.schedule, "Schedule", { min: 0, max: 120 });
    room = req.body.room === undefined ? "" : requiredText(req.body.room, "Room", { min: 0, max: 40 });
  } catch (error) { return res.status(400).json({ message: /^(Credits|Semester)/.test(error.message) ? error.message : "Invalid subject data." }); }
  if (db.subjects.some((item) => String(item.code || "").trim().toLowerCase() === code.toLowerCase() && String(item.className || "") === className)) {
    return res.status(409).json({ message: "A subject with this code already exists for that class." });
  }
  const subject = {
    id: makeId("sub"),
    subjectName, code, teacher, className,
    schedule, room, department, semester, credits
  };
  db.subjects.push(subject);
  await writeDb(db);
  res.status(201).json({ subject });
});

subjectsRouter.put("/:id", requireAuth, requireAdmin, async (req, res) => {
  const db = await readDb();
  try { validateKeys(req.body || {}, SUBJECT_FIELDS); } catch { return res.status(400).json({ message: "Invalid subject data." }); }
  const subject = db.subjects.find((item) => item.id === req.params.id);
  if (!subject) return res.status(404).json({ message: "Subject not found." });
  for (const [field, max] of SUBJECT_TEXT_FIELDS) {
    if (req.body[field] !== undefined) { try { requiredText(req.body[field], field, { min: 0, max }); } catch { return res.status(400).json({ message: "Invalid subject data." }); } }
  }
  // A semester value that is already stored is accepted unchanged even if it
  // predates the 1-12 rule, so re-saving an old subject doesn't fail.
  let semester; let credits;
  try {
    if (req.body.semester !== undefined) semester = req.body.semester === subject.semester ? subject.semester : parseSemester(req.body.semester);
    if (req.body.credits !== undefined) credits = parseCredits(req.body.credits);
  } catch (error) { return res.status(400).json({ message: error.message }); }
  // Fields the mark sheet depends on can't move under published/locked results,
  // and a class change would orphan marks already entered for the old class.
  const sheet = findSheet(db, subject.id);
  const changes = (field, value) => value !== undefined && value !== (subject[field] ?? (field === "credits" ? null : ""));
  const sheetFrozen = sheet && sheet.status !== "draft";
  if (sheetFrozen && (changes("className", req.body.className) || changes("semester", semester) || changes("credits", credits) || changes("code", req.body.code))) {
    return res.status(409).json({ message: "This subject has published results. Ask an admin to unlock its mark sheet before changing its class, code, semester or credits." });
  }
  if (changes("className", req.body.className) && (db.internalMarks || []).some((item) => item.subjectId === subject.id)) {
    return res.status(409).json({ message: "Marks are already entered for this subject's class. Delete or move them before changing the class." });
  }
  for (const [field] of SUBJECT_TEXT_FIELDS) {
    if (req.body[field] !== undefined) subject[field] = req.body[field];
  }
  if (semester !== undefined) subject.semester = semester;
  if (credits !== undefined) subject.credits = credits;
  await writeDb(db);
  res.json({ subject });
});

subjectsRouter.delete("/:id", requireAuth, requireAdmin, async (req, res) => {
  const db = await readDb();
  const id = req.params.id;
  if (!db.subjects.some((item) => item.id === id)) return res.status(404).json({ message: "Subject not found." });
  // Published/locked results are transcripts; don't delete them as a side effect.
  const sheet = findSheet(db, id);
  if (sheet && sheet.status !== "draft") return res.status(409).json({ message: "This subject has published results. Unlock its mark sheet (Marks & Results) before deleting the subject." });
  db.subjects = db.subjects.filter((item) => item.id !== id);
  db.markSheets = (db.markSheets || []).filter((item) => item.subjectId !== id);
  db.results = (db.results || []).filter((item) => item.subjectId !== id);
  db.classes = db.classes.filter((item) => item.subjectId !== id);
  db.attendance = db.attendance.filter((item) => item.subjectId !== id);
  // Quizzes, marks and live sessions all key off subjectId and were left
  // dangling, so /quiz/active kept serving questions for a deleted subject.
  const orphanQuizIds = new Set((db.quizzes || []).filter((item) => item.subjectId === id).map((item) => item.id));
  db.quizzes = (db.quizzes || []).filter((item) => item.subjectId !== id);
  db.quizAttempts = (db.quizAttempts || []).filter((item) => !orphanQuizIds.has(item.quizId));
  db.quizSessions = (db.quizSessions || []).filter((item) => item.subjectId !== id);
  db.internalMarks = (db.internalMarks || []).filter((item) => item.subjectId !== id);
  db.attendanceSessions = (db.attendanceSessions || []).filter((item) => item.subjectId !== id);
  await writeDb(db);
  res.json({ ok: true });
});

subjectsRouter.post("/classes", requireAuth, requireAdmin, async (req, res) => {
  const db = await readDb();
  try { validateKeys(req.body || {}, ["subjectId", "className", "day", "startTime", "endTime", "room"]); } catch { return res.status(400).json({ message: "Invalid timetable data." }); }
  if (!validId(req.body.subjectId)) return res.status(400).json({ message: "Subject ID is invalid." });
  if (!(db.subjects || []).some((item) => item.id === req.body.subjectId)) return res.status(404).json({ message: "Subject not found." });
  for (const [field, max] of [["className", 80], ["day", 20], ["startTime", 5], ["endTime", 5]]) {
    try { requiredText(req.body[field], field, { max }); } catch { return res.status(400).json({ message: "Invalid timetable data." }); }
  }
  try { enumValue(req.body.day, "Day", ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]); } catch { return res.status(400).json({ message: "Invalid timetable data." }); }
  if (!validTime(req.body.startTime) || !validTime(req.body.endTime) || req.body.startTime >= req.body.endTime) return res.status(400).json({ message: "Invalid timetable times." });
  const classItem = {
    id: makeId("cls"),
    subjectId: req.body.subjectId,
    className: req.body.className,
    day: req.body.day,
    startTime: req.body.startTime,
    endTime: req.body.endTime,
    room: req.body.room || ""
  };
  db.classes.push(classItem);
  await writeDb(db);
  res.status(201).json({ classItem });
});

subjectsRouter.put("/classes/:id", requireAuth, requireAdmin, async (req, res) => {
  const db = await readDb();
  try { validateKeys(req.body || {}, ["subjectId", "className", "day", "startTime", "endTime", "room"]); } catch { return res.status(400).json({ message: "Invalid timetable data." }); }
  const classItem = db.classes.find((item) => item.id === req.params.id);
  if (!classItem) return res.status(404).json({ message: "Class timing not found." });
  if (req.body.subjectId !== undefined && !validId(req.body.subjectId)) return res.status(400).json({ message: "Subject ID is invalid." });
  if (req.body.subjectId !== undefined && !(db.subjects || []).some((item) => item.id === req.body.subjectId)) return res.status(404).json({ message: "Subject not found." });
  for (const [field, max] of [["className", 80], ["day", 20], ["startTime", 5], ["endTime", 5], ["room", 40]]) {
    if (req.body[field] !== undefined) { try { requiredText(req.body[field], field, { min: 0, max }); } catch { return res.status(400).json({ message: "Invalid timetable data." }); } }
  }
  if (req.body.day !== undefined) { try { enumValue(req.body.day, "Day", ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]); } catch { return res.status(400).json({ message: "Invalid timetable data." }); } }
  const nextStart = req.body.startTime ?? classItem.startTime; const nextEnd = req.body.endTime ?? classItem.endTime;
  if (!validTime(nextStart) || !validTime(nextEnd) || nextStart >= nextEnd) return res.status(400).json({ message: "Invalid timetable times." });
  ["subjectId", "className", "day", "startTime", "endTime", "room"].forEach((field) => {
    if (req.body[field] !== undefined) classItem[field] = req.body[field];
  });
  await writeDb(db);
  res.json({ classItem });
});

subjectsRouter.delete("/classes/:id", requireAuth, requireAdmin, async (req, res) => {
  const db = await readDb();
  db.classes = db.classes.filter((item) => item.id !== req.params.id);
  await writeDb(db);
  res.json({ ok: true });
});
