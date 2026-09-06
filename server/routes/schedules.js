import { Router } from "express";
import { makeId, readDb, writeDb } from "../db/fileStore.js";
import { requireAdmin, requireAuth } from "../middleware/auth.js";
import { enumValue, requiredText, validateKeys, validTime } from "../services/validation.js";

export const schedulesRouter = Router();

function minutes(value) { const [hours, mins] = String(value || "").split(":").map(Number); return hours * 60 + mins; }
function overlaps(a, b) { return a.day === b.day && minutes(a.startTime) < minutes(b.endTime) && minutes(b.startTime) < minutes(a.endTime); }
function conflicts(entries, candidate, ignoreId = "") { return entries.filter((item) => item.id !== ignoreId && overlaps(item, candidate)).flatMap((item) => { const types = []; if (String(item.teacher).trim().toLowerCase() === String(candidate.teacher).trim().toLowerCase()) types.push("faculty"); if (String(item.room).trim().toLowerCase() === String(candidate.room).trim().toLowerCase()) types.push("classroom"); if (String(item.section).trim().toLowerCase() === String(candidate.section).trim().toLowerCase()) types.push("section"); return types.map((type) => ({ type, record: item })); }); }
function suggestions(entries, candidate) { return [1, 2, 3, 4, 5, 6, 7, 8].filter((period) => !entries.some((item) => item.day === candidate.day && item.period === period && ["teacher", "room", "section"].some((field) => String(item[field]).toLowerCase() === String(candidate[field]).toLowerCase()))).slice(0, 3).map((period) => ({ period, message: `Try period ${period} on ${candidate.day}.` })); }

function visibleSchedules(db, user, query = {}) {
  let schedules = db.schedules || [];
  if (user.role === "student") {
    const student = db.students.find((item) => item.id === user.id);
    schedules = schedules.filter((item) => item.section === student?.className);
  }
  if (query.section) schedules = schedules.filter((item) => item.section === query.section);
  if (query.day) schedules = schedules.filter((item) => item.day === query.day);
  if (query.faculty) schedules = schedules.filter((item) => String(item.teacher).toLowerCase().includes(String(query.faculty).toLowerCase()));
  if (query.room) schedules = schedules.filter((item) => String(item.room).toLowerCase() === String(query.room).toLowerCase());
  if (query.department) schedules = schedules.filter((item) => item.department === query.department);
  if (query.semester) schedules = schedules.filter((item) => item.semester === query.semester);
  return schedules;
}

schedulesRouter.get("/", requireAuth, async (req, res) => {
  const db = await readDb();
  db.schedules ||= [];
  const allSchedules = visibleSchedules(db, req.user, req.query); const hasPagination = req.query.page !== undefined || req.query.perPage !== undefined; const page = Math.max(1, Math.min(10000, Number.parseInt(req.query.page || "1", 10) || 1)); const perPage = Math.max(1, Math.min(1000, Number.parseInt(req.query.perPage || "1000", 10) || 1000)); const schedules = hasPagination ? allSchedules.slice((page - 1) * perPage, page * perPage) : allSchedules;
  const sections = [...new Set(db.schedules.map((item) => item.section))].sort();
  res.json({ schedules, pagination: { page, perPage, total: allSchedules.length, pages: Math.ceil(allSchedules.length / perPage) }, sections, departments: [...new Set(db.schedules.map((item) => item.department).filter(Boolean))].sort(), semesters: [...new Set(db.schedules.map((item) => item.semester).filter(Boolean))].sort(), faculty: [...new Set(db.schedules.map((item) => item.teacher).filter(Boolean))].sort(), classrooms: [...new Set(db.schedules.map((item) => item.room).filter(Boolean))].sort() });
});

schedulesRouter.post("/", requireAuth, requireAdmin, async (req, res) => {
  const db = await readDb();
  db.schedules ||= [];
  try { validateKeys(req.body || {}, ["day", "section", "period", "startTime", "endTime", "subject", "teacher", "room", "activity", "notes", "department", "semester"]); } catch { return res.status(400).json({ message: "Invalid timetable data." }); }
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
    subject, teacher, activity, notes, department: String(req.body.department || "").slice(0, 120), semester: String(req.body.semester || "").slice(0, 40)
  };
  const foundConflicts = conflicts(db.schedules, schedule);
  if (foundConflicts.length) return res.status(409).json({ message: "Timetable conflict detected. Saving was blocked.", conflicts: foundConflicts.map(({ type, record }) => ({ type, id: record.id, subject: record.subject, teacher: record.teacher, room: record.room, section: record.section, day: record.day, startTime: record.startTime, endTime: record.endTime })), suggestions: suggestions(db.schedules, schedule) });
  db.schedules.push(schedule);
  await writeDb(db);
  res.status(201).json({ schedule });
});

schedulesRouter.put("/:id", requireAuth, requireAdmin, async (req, res) => {
  const db = await readDb();
  db.schedules ||= [];
  try { validateKeys(req.body || {}, ["day", "section", "period", "startTime", "endTime", "subject", "teacher", "room", "activity", "notes", "department", "semester"]); } catch { return res.status(400).json({ message: "Invalid timetable data." }); }
  const schedule = db.schedules.find((item) => item.id === req.params.id);
  if (!schedule) return res.status(404).json({ message: "Schedule item not found." });
  if (req.body.period !== undefined && (!Number.isInteger(Number(req.body.period)) || Number(req.body.period) < 1 || Number(req.body.period) > 12)) return res.status(400).json({ message: "Period is invalid." });
  if ((req.body.startTime !== undefined && !validTime(req.body.startTime)) || (req.body.endTime !== undefined && !validTime(req.body.endTime))) return res.status(400).json({ message: "Time is invalid." });
  for (const [field, max] of [["section", 80], ["subject", 120], ["teacher", 120], ["room", 40], ["activity", 60], ["notes", 500], ["department", 120], ["semester", 40]]) {
    if (req.body[field] !== undefined) { try { requiredText(req.body[field], field, { min: 0, max }); } catch { return res.status(400).json({ message: "Invalid timetable data." }); } }
  }
  ["day", "section", "room", "startTime", "endTime", "subject", "teacher", "activity", "notes", "department", "semester"].forEach((field) => {
    if (req.body[field] !== undefined) schedule[field] = req.body[field];
  });
  if (req.body.period !== undefined) schedule.period = Number(req.body.period);
  const foundConflicts = conflicts(db.schedules, schedule, schedule.id);
  if (foundConflicts.length) return res.status(409).json({ message: "Timetable conflict detected. Saving was blocked.", conflicts: foundConflicts.map(({ type, record }) => ({ type, id: record.id, subject: record.subject, teacher: record.teacher, room: record.room, section: record.section, day: record.day, startTime: record.startTime, endTime: record.endTime })), suggestions: suggestions(db.schedules.filter((item) => item.id !== schedule.id), schedule) });
  await writeDb(db);
  res.json({ schedule });
});

schedulesRouter.delete("/:id", requireAuth, requireAdmin, async (req, res) => {
  const db = await readDb();
  db.schedules = (db.schedules || []).filter((item) => item.id !== req.params.id);
  await writeDb(db);
  res.json({ ok: true });
});
