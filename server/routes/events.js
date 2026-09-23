import { Router } from "express";
import { makeId, readDb, writeDb } from "../db/fileStore.js";
import { requireAuth, requireStaff } from "../middleware/auth.js";
import { classesTaughtByTeacher } from "../services/accessService.js";
import { enumValue, requiredText, validateKeys } from "../services/validation.js";

export const eventsRouter = Router();

export const EVENT_CATEGORIES = ["Academic", "Cultural", "Sports", "Workshop", "Holiday", "Exam", "Other"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const EVENT_FIELDS = ["title", "description", "category", "startDate", "endDate", "startTime", "location", "audience"];

function ensureCollections(db) {
  db.events ||= [];
}

function isValidDate(value) {
  if (typeof value !== "string" || !DATE_RE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

// Everyone sees "all"-audience events. A specific audience is a className:
// the creator and any admin can always see it, a teacher sees it if they
// teach that class, and a student sees it only if it's their own class.
function visibleToUser(event, user, db) {
  if (event.audience === "all") return true;
  if (user.role === "admin") return true;
  if (event.createdBy?.id === user.id) return true;
  if (user.role === "teacher") return classesTaughtByTeacher(db, user.code).includes(event.audience);
  if (user.role === "student") {
    const student = (db.students || []).find((item) => item.id === user.id);
    return Boolean(student && student.className === event.audience);
  }
  return false;
}

function publicEvent(event) {
  const today = new Date().toISOString().slice(0, 10);
  const endDate = event.endDate || event.startDate;
  const status = endDate < today ? "past" : event.startDate <= today ? "ongoing" : "upcoming";
  return { ...event, status };
}

function canManage(event, user) {
  return user.role === "admin" || event.createdBy?.id === user.id;
}

// Validates and applies the audience field onto `target`. Returns an error
// message string, or null on success.
function applyAudience(target, rawAudience, db, user) {
  let audience = rawAudience === undefined || rawAudience === "" ? "all" : String(rawAudience).trim().slice(0, 80);
  if (!audience) audience = "all";
  if (audience !== "all" && user.role === "teacher" && !classesTaughtByTeacher(db, user.code).includes(audience)) {
    return "You can only publish events for classes you teach.";
  }
  target.audience = audience;
  return null;
}

eventsRouter.get("/", requireAuth, async (req, res) => {
  const db = await readDb();
  ensureCollections(db);
  let events = db.events.filter((event) => visibleToUser(event, req.user, db));
  if (req.query.category) events = events.filter((event) => event.category === req.query.category);
  if (req.query.mine === "true" && req.user.role !== "student") {
    events = events.filter((event) => event.createdBy?.id === req.user.id);
  }
  events = events.map(publicEvent).sort((a, b) => `${a.startDate}${a.startTime || ""}`.localeCompare(`${b.startDate}${b.startTime || ""}`));

  const availableClasses =
    req.user.role === "admin"
      ? [...new Set((db.students || []).map((item) => item.className).filter(Boolean))].sort()
      : req.user.role === "teacher"
      ? classesTaughtByTeacher(db, req.user.code)
      : [];

  const now = new Date();
  const weekAhead = new Date(now.getTime() + 7 * 86400000);
  res.json({
    events,
    categories: EVENT_CATEGORIES,
    availableClasses,
    stats: {
      total: events.length,
      upcoming: events.filter((event) => event.status !== "past").length,
      thisWeek: events.filter((event) => event.status !== "past" && new Date(event.startDate) <= weekAhead).length
    }
  });
});

eventsRouter.post("/", requireAuth, requireStaff, async (req, res) => {
  try {
    validateKeys(req.body || {}, EVENT_FIELDS);
  } catch {
    return res.status(400).json({ message: "Request contains unsupported fields." });
  }
  const db = await readDb();
  ensureCollections(db);

  let title, description, category, location;
  try {
    title = requiredText(req.body.title, "Title", { max: 160 });
    description = req.body.description === undefined ? "" : requiredText(req.body.description, "Description", { min: 0, max: 3000 });
    category = enumValue(req.body.category, "Category", EVENT_CATEGORIES);
    location = req.body.location === undefined ? "" : requiredText(req.body.location, "Location", { min: 0, max: 160 });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }

  if (!isValidDate(req.body.startDate)) return res.status(400).json({ message: "A valid start date is required." });
  const startDate = req.body.startDate;
  let endDate = startDate;
  if (req.body.endDate !== undefined && req.body.endDate !== "") {
    if (!isValidDate(req.body.endDate)) return res.status(400).json({ message: "End date is invalid." });
    endDate = req.body.endDate;
  }
  if (endDate < startDate) return res.status(400).json({ message: "End date cannot be before the start date." });

  let startTime = "";
  if (req.body.startTime !== undefined && req.body.startTime !== "") {
    if (!TIME_RE.test(req.body.startTime)) return res.status(400).json({ message: "Start time is invalid." });
    startTime = req.body.startTime;
  }

  const event = { id: makeId("evt"), title, description, category, startDate, endDate, startTime, location, audience: "all", createdBy: { id: req.user.id, name: req.user.name, role: req.user.role }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  const audienceError = applyAudience(event, req.body.audience, db, req.user);
  if (audienceError) return res.status(403).json({ message: audienceError });

  db.events.push(event);
  await writeDb(db);
  res.status(201).json({ event: publicEvent(event), message: "Event published." });
});

eventsRouter.put("/:id", requireAuth, requireStaff, async (req, res) => {
  try {
    validateKeys(req.body || {}, EVENT_FIELDS);
  } catch {
    return res.status(400).json({ message: "Request contains unsupported fields." });
  }
  const db = await readDb();
  ensureCollections(db);
  const event = db.events.find((item) => item.id === req.params.id);
  if (!event) return res.status(404).json({ message: "Event not found." });
  if (!canManage(event, req.user)) return res.status(403).json({ message: "You can only edit events you created." });

  try {
    if (req.body.title !== undefined) event.title = requiredText(req.body.title, "Title", { max: 160 });
    if (req.body.description !== undefined) event.description = requiredText(req.body.description, "Description", { min: 0, max: 3000 });
    if (req.body.category !== undefined) event.category = enumValue(req.body.category, "Category", EVENT_CATEGORIES);
    if (req.body.location !== undefined) event.location = requiredText(req.body.location, "Location", { min: 0, max: 160 });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }

  if (req.body.startDate !== undefined) {
    if (!isValidDate(req.body.startDate)) return res.status(400).json({ message: "A valid start date is required." });
    event.startDate = req.body.startDate;
  }
  if (req.body.endDate !== undefined) {
    if (req.body.endDate === "") event.endDate = event.startDate;
    else {
      if (!isValidDate(req.body.endDate)) return res.status(400).json({ message: "End date is invalid." });
      event.endDate = req.body.endDate;
    }
  }
  if (event.endDate < event.startDate) return res.status(400).json({ message: "End date cannot be before the start date." });

  if (req.body.startTime !== undefined) {
    if (req.body.startTime === "") event.startTime = "";
    else {
      if (!TIME_RE.test(req.body.startTime)) return res.status(400).json({ message: "Start time is invalid." });
      event.startTime = req.body.startTime;
    }
  }

  if (req.body.audience !== undefined) {
    const audienceError = applyAudience(event, req.body.audience, db, req.user);
    if (audienceError) return res.status(403).json({ message: audienceError });
  }

  event.updatedAt = new Date().toISOString();
  await writeDb(db);
  res.json({ event: publicEvent(event), message: "Event updated." });
});

eventsRouter.delete("/:id", requireAuth, requireStaff, async (req, res) => {
  const db = await readDb();
  ensureCollections(db);
  const event = db.events.find((item) => item.id === req.params.id);
  if (!event) return res.status(404).json({ message: "Event not found." });
  if (!canManage(event, req.user)) return res.status(403).json({ message: "You can only delete events you created." });
  db.events = db.events.filter((item) => item.id !== event.id);
  await writeDb(db);
  res.json({ success: true, message: "Event deleted." });
});
