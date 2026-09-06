import { Router } from "express";
import { makeId, readDb, writeDb } from "../db/fileStore.js";
import { requireAdmin, requireAuth } from "../middleware/auth.js";
import { enumValue, requiredText, validateKeys, validTime } from "../services/validation.js";

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
  try { validateKeys(req.body || {}, ["day", "section", "period", "startTime", "endTime", "subject", "teacher", "room", "activity", "notes"]); } catch { return res.status(400).json({ message: "Invalid timetable data." }); }
  let day, section, subject, teacher, room, activity, notes;
  try {
    day = enumValue(req.body.day, "Day", ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]);
    section = requiredText(req.body.section, "Section", { max: 80 });
    subject = requiredText(req.body.subject, "Subject", { max: 120 });
    teacher = requiredText(req.body.teacher, "Teacher", { max: 120 });
    room = requiredText(req.body.room, "Room", { max: 40 });
    activity = req.body.activity === undefined ? "Lecture" : requiredText(req.body.activity, "Activity", { max: 60 });
    notes = req.body.notes === undefined ? "" : requiredText(req.body.notes, "Notes", { min: 0, max: 500 });
  } catch { return res.status(400).json({ message: "Invalid timetable data." }); }
  const period = Number(req.body.period);
  if (!Number.isInteger(period) || period < 1 || period > 12 || !validTime(req.body.startTime) || !validTime(req.body.endTime)) return res.status(400).json({ message: "Period and times are invalid." });
  const schedule = {
    id: makeId("sch"),
    day, section, room, period,
    startTime: req.body.startTime,
    endTime: req.body.endTime,
    subject, teacher, activity, notes
  };
  db.schedules.push(schedule);
  await writeDb(db);
  res.status(201).json({ schedule });
});

schedulesRouter.put("/:id", requireAuth, requireAdmin, async (req, res) => {
  const db = await readDb();
  db.schedules ||= [];
  try { validateKeys(req.body || {}, ["day", "section", "period", "startTime", "endTime", "subject", "teacher", "room", "activity", "notes"]); } catch { return res.status(400).json({ message: "Invalid timetable data." }); }
  const schedule = db.schedules.find((item) => item.id === req.params.id);
  if (!schedule) return res.status(404).json({ message: "Schedule item not found." });
  if (req.body.period !== undefined && (!Number.isInteger(Number(req.body.period)) || Number(req.body.period) < 1 || Number(req.body.period) > 12)) return res.status(400).json({ message: "Period is invalid." });
  if ((req.body.startTime !== undefined && !validTime(req.body.startTime)) || (req.body.endTime !== undefined && !validTime(req.body.endTime))) return res.status(400).json({ message: "Time is invalid." });
  for (const [field, max] of [["section", 80], ["subject", 120], ["teacher", 120], ["room", 40], ["activity", 60], ["notes", 500]]) {
    if (req.body[field] !== undefined) { try { requiredText(req.body[field], field, { min: 0, max }); } catch { return res.status(400).json({ message: "Invalid timetable data." }); } }
  }
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
