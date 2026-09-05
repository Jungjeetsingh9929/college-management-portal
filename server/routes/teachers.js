import bcrypt from "bcryptjs";
import { Router } from "express";
import { makeId, readDb, writeDb } from "../db/fileStore.js";
import { requireAdmin, requireAuth, requireStaff } from "../middleware/auth.js";
import { validPassword } from "../services/validation.js";

export const teachersRouter = Router();

teachersRouter.get("/", requireAuth, requireStaff, async (_req, res) => {
  const db = await readDb();
  db.teachers ||= [];
  res.json({ teachers: db.teachers.map(({ password, ...teacher }) => teacher) });
});

teachersRouter.post("/", requireAuth, requireAdmin, async (req, res) => {
  const db = await readDb();
  db.teachers ||= [];
  if (!req.body.code || !req.body.name || !req.body.department || !req.body.email || !validPassword(req.body.password)) {
    return res.status(400).json({ message: "Teacher code, name, department, email, and a password of at least 8 characters are required." });
  }
  const codeExists = db.teachers.some((teacher) => teacher.code.toLowerCase() === String(req.body.code).toLowerCase());
  if (codeExists) return res.status(409).json({ message: "Teacher code already exists." });
  const teacher = {
    id: makeId("tch"),
    code: req.body.code,
    name: req.body.name,
    department: req.body.department,
    email: String(req.body.email).trim().toLowerCase(),
    password: bcrypt.hashSync(req.body.password, 10),
    phone: req.body.phone || "",
    cabin: req.body.cabin || "",
    subjects: Array.isArray(req.body.subjects) ? req.body.subjects : []
  };
  db.teachers.push(teacher);
  await writeDb(db);
  const { password, ...safeTeacher } = teacher;
  res.status(201).json({ teacher: safeTeacher });
});

teachersRouter.put("/:id", requireAuth, requireAdmin, async (req, res) => {
  const db = await readDb();
  db.teachers ||= [];
  const teacher = db.teachers.find((item) => item.id === req.params.id);
  if (!teacher) return res.status(404).json({ message: "Teacher not found." });
  if (req.body.password !== undefined && !validPassword(req.body.password)) {
    return res.status(400).json({ message: "Password must be between 8 and 200 characters." });
  }
  ["code", "name", "department", "email", "phone", "cabin"].forEach((field) => {
    if (req.body[field] !== undefined) teacher[field] = req.body[field];
  });
  if (req.body.email !== undefined) teacher.email = String(req.body.email).trim().toLowerCase();
  if (req.body.password !== undefined) teacher.password = bcrypt.hashSync(req.body.password, 10);
  if (Array.isArray(req.body.subjects)) teacher.subjects = req.body.subjects;
  await writeDb(db);
  const { password, ...safeTeacher } = teacher;
  res.json({ teacher: safeTeacher });
});

teachersRouter.delete("/:id", requireAuth, requireAdmin, async (req, res) => {
  const db = await readDb();
  db.teachers = (db.teachers || []).filter((item) => item.id !== req.params.id);
  await writeDb(db);
  res.json({ ok: true });
});
