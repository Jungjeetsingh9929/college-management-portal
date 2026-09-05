import { Router } from "express";
import { makeId, readDb, writeDb } from "../db/fileStore.js";
import { requireAdmin, requireAuth } from "../middleware/auth.js";

export const subjectsRouter = Router();

subjectsRouter.get("/", requireAuth, async (_req, res) => {
  const db = await readDb();
  res.json({ subjects: db.subjects, classes: db.classes });
});

subjectsRouter.post("/", requireAuth, requireAdmin, async (req, res) => {
  const db = await readDb();
  const subject = {
    id: makeId("sub"),
    subjectName: req.body.subjectName,
    code: req.body.code,
    teacher: req.body.teacher,
    className: req.body.className,
    schedule: req.body.schedule || "",
    room: req.body.room || ""
  };
  db.subjects.push(subject);
  await writeDb(db);
  res.status(201).json({ subject });
});

subjectsRouter.put("/:id", requireAuth, requireAdmin, async (req, res) => {
  const db = await readDb();
  const subject = db.subjects.find((item) => item.id === req.params.id);
  if (!subject) return res.status(404).json({ message: "Subject not found." });
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
  const classItem = db.classes.find((item) => item.id === req.params.id);
  if (!classItem) return res.status(404).json({ message: "Class timing not found." });
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
