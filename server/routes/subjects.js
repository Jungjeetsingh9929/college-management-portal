import { Router } from "express";
import { makeId, readDb, writeDb } from "../db/fileStore.js";
import { requireAdmin, requireAuth } from "../middleware/auth.js";
import { requiredText, validateKeys, validId } from "../services/validation.js";

export const subjectsRouter = Router();

subjectsRouter.get("/", requireAuth, async (_req, res) => {
  const db = await readDb();
  res.json({ subjects: db.subjects, classes: db.classes });
});

subjectsRouter.post("/", requireAuth, requireAdmin, async (req, res) => {
  const db = await readDb();
  try { validateKeys(req.body || {}, ["subjectName", "code", "teacher", "className", "schedule", "room"]); } catch { return res.status(400).json({ message: "Invalid subject data." }); }
  let subjectName, code, teacher, className;
  try {
    subjectName = requiredText(req.body.subjectName, "Subject name", { max: 120 });
    code = requiredText(req.body.code, "Code", { max: 30 });
    teacher = requiredText(req.body.teacher, "Teacher", { max: 120 });
    className = requiredText(req.body.className, "Class", { max: 80 });
  } catch { return res.status(400).json({ message: "Invalid subject data." }); }
  const subject = {
    id: makeId("sub"),
    subjectName, code, teacher, className,
    schedule: req.body.schedule || "",
    room: req.body.room || ""
  };
  db.subjects.push(subject);
  await writeDb(db);
  res.status(201).json({ subject });
});

subjectsRouter.put("/:id", requireAuth, requireAdmin, async (req, res) => {
  const db = await readDb();
  try { validateKeys(req.body || {}, ["subjectName", "code", "teacher", "className", "schedule", "room"]); } catch { return res.status(400).json({ message: "Invalid subject data." }); }
  const subject = db.subjects.find((item) => item.id === req.params.id);
  if (!subject) return res.status(404).json({ message: "Subject not found." });
  for (const [field, max] of [["subjectName", 120], ["code", 30], ["teacher", 120], ["className", 80], ["schedule", 120], ["room", 40]]) {
    if (req.body[field] !== undefined) { try { requiredText(req.body[field], field, { min: 0, max }); } catch { return res.status(400).json({ message: "Invalid subject data." }); } }
  }
  ["subjectName", "code", "teacher", "className", "schedule", "room"].forEach((field) => {
    if (req.body[field] !== undefined) subject[field] = req.body[field];
  });
  await writeDb(db);
  res.json({ subject });
});

subjectsRouter.delete("/:id", requireAuth, requireAdmin, async (req, res) => {
  const db = await readDb();
  db.subjects = db.subjects.filter((item) => item.id !== req.params.id);
  db.classes = db.classes.filter((item) => item.subjectId !== req.params.id);
  db.attendance = db.attendance.filter((item) => item.subjectId !== req.params.id);
  await writeDb(db);
  res.json({ ok: true });
});

subjectsRouter.post("/classes", requireAuth, requireAdmin, async (req, res) => {
  const db = await readDb();
  try { validateKeys(req.body || {}, ["subjectId", "className", "day", "startTime", "endTime", "room"]); } catch { return res.status(400).json({ message: "Invalid timetable data." }); }
  if (!validId(req.body.subjectId)) return res.status(400).json({ message: "Subject ID is invalid." });
  for (const [field, max] of [["className", 80], ["day", 20], ["startTime", 5], ["endTime", 5]]) {
    try { requiredText(req.body[field], field, { max }); } catch { return res.status(400).json({ message: "Invalid timetable data." }); }
  }
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
  for (const [field, max] of [["className", 80], ["day", 20], ["startTime", 5], ["endTime", 5], ["room", 40]]) {
    if (req.body[field] !== undefined) { try { requiredText(req.body[field], field, { min: 0, max }); } catch { return res.status(400).json({ message: "Invalid timetable data." }); } }
  }
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
