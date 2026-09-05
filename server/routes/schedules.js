import { Router } from "express";
import { makeId, readDb, writeDb } from "../db/fileStore.js";
import { requireAdmin, requireAuth } from "../middleware/auth.js";

export const schedulesRouter = Router();

function visibleSchedules(db, user, query = {}) {
  let schedules = db.schedules || [];
  if (user.role === "student") {
    const student = db.students.find((item) => item.id === user.id);
    schedules = schedules.filter((item) => item.section === student?.className);
  }
  if (query.section) schedules = schedules.filter((item) => item.section === query.section);
  if (query.day) schedules = schedules.filter((item) => item.day === query.day);
  return schedules;
}

schedulesRouter.get("/", requireAuth, async (req, res) => {
  const db = await readDb();
  db.schedules ||= [];
  const schedules = visibleSchedules(db, req.user, req.query);
  const sections = [...new Set(db.schedules.map((item) => item.section))].sort();
  res.json({ schedules, sections });
});

schedulesRouter.post("/", requireAuth, requireAdmin, async (req, res) => {
  const db = await readDb();
  db.schedules ||= [];
  const required = ["day", "section", "period", "startTime", "endTime", "subject", "teacher", "room"];
  if (required.some((field) => !req.body[field])) {
    return res.status(400).json({ message: "Day, section, period, time, subject, teacher, and room are required." });
  }
  const schedule = {
    id: makeId("sch"),
    day: req.body.day,
    section: req.body.section,
    room: req.body.room,
    period: Number(req.body.period),
    startTime: req.body.startTime,
    endTime: req.body.endTime,
    subject: req.body.subject,
    teacher: req.body.teacher,
    activity: req.body.activity || "Lecture",
    notes: req.body.notes || ""
  };
  db.schedules.push(schedule);
  await writeDb(db);
  res.status(201).json({ schedule });
});

schedulesRouter.put("/:id", requireAuth, requireAdmin, async (req, res) => {
  const db = await readDb();
  db.schedules ||= [];
  const schedule = db.schedules.find((item) => item.id === req.params.id);
  if (!schedule) return res.status(404).json({ message: "Schedule item not found." });
  ["day", "section", "room", "startTime", "endTime", "subject", "teacher", "activity", "notes"].forEach((field) => {
    if (req.body[field] !== undefined) schedule[field] = req.body[field];
  });
  if (req.body.period !== undefined) schedule.period = Number(req.body.period);
  await writeDb(db);
  res.json({ schedule });
});

schedulesRouter.delete("/:id", requireAuth, requireAdmin, async (req, res) => {
  const db = await readDb();
  db.schedules = (db.schedules || []).filter((item) => item.id !== req.params.id);
  await writeDb(db);
  res.json({ ok: true });
});
