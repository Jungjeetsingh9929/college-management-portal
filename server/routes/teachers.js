import bcrypt from "bcryptjs";
import { Router } from "express";
import { makeId, readDb, writeDb } from "../db/fileStore.js";
import { requireAdmin, requireAuth, requireStaff } from "../middleware/auth.js";
import { PASSWORD_REQUIREMENTS, requiredText, validEmail, validPassword, validateKeys } from "../services/validation.js";
import { emailInUse, normalizeEmail } from "../services/accountService.js";
import { revokeSessionsForUser } from "../middleware/auth.js";

export const teachersRouter = Router();

teachersRouter.get("/", requireAuth, requireStaff, async (_req, res) => {
  const db = await readDb();
  db.teachers ||= [];
  res.json({ teachers: db.teachers.map(({ password, ...teacher }) => ({ ...teacher, workload: (db.schedules || []).filter((item) => String(item.teacher || "").toLowerCase().includes(String(teacher.code || "").toLowerCase())).length })) });
});

teachersRouter.post("/", requireAuth, requireAdmin, async (req, res) => {
  const db = await readDb();
  db.teachers ||= [];
  try { validateKeys(req.body || {}, ["code", "name", "department", "email", "password", "phone", "cabin", "subjects"]); } catch { return res.status(400).json({ message: "Invalid teacher data." }); }
  if (!validEmail(req.body.email) || !validPassword(req.body.password)) {
    return res.status(400).json({ message: `Teacher code, name, department, email, and a ${PASSWORD_REQUIREMENTS.toLowerCase()} are required.` });
  }
  let code, name, department;
  try { code = requiredText(req.body.code, "Teacher code", { max: 30 }); name = requiredText(req.body.name, "Name", { max: 120 }); department = requiredText(req.body.department, "Department", { max: 100 }); } catch { return res.status(400).json({ message: "Invalid teacher data." }); }
  const codeExists = db.teachers.some((teacher) => String(teacher.code || "").toLowerCase() === code.toLowerCase());
  if (codeExists) return res.status(409).json({ message: "Teacher code already exists." });
  // Teacher creation never checked the email at all, so an admin could hand a
  // teacher account the same address as an existing student - making login,
  // password reset and OTP delivery ambiguous for both.
  if (emailInUse(db, req.body.email)) return res.status(409).json({ message: "This email already has an account." });
  const teacher = {
    id: makeId("tch"),
    code, name, department,
    email: String(req.body.email).trim().toLowerCase(),
    password: bcrypt.hashSync(req.body.password, 12),
    passwordVersion: 0,
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
  try { validateKeys(req.body || {}, ["code", "name", "department", "email", "password", "phone", "cabin", "subjects"]); } catch { return res.status(400).json({ message: "Invalid teacher data." }); }
  const teacher = db.teachers.find((item) => item.id === req.params.id);
  if (!teacher) return res.status(404).json({ message: "Teacher not found." });
  if (req.body.password !== undefined && !validPassword(req.body.password)) {
    return res.status(400).json({ message: PASSWORD_REQUIREMENTS });
  }
  if (req.body.email !== undefined && !validEmail(req.body.email)) return res.status(400).json({ message: "Email is invalid." });
  if (req.body.email !== undefined && emailInUse(db, req.body.email, { ignoreId: teacher.id })) return res.status(409).json({ message: "This email already has an account." });
  if (req.body.code !== undefined && db.teachers.some((item) => item.id !== teacher.id && String(item.code || "").toLowerCase() === String(req.body.code).trim().toLowerCase())) return res.status(409).json({ message: "Teacher code already exists." });
  for (const [field, max] of [["code", 30], ["name", 120], ["department", 100], ["phone", 30], ["cabin", 40]]) {
    if (req.body[field] !== undefined) { try { requiredText(req.body[field], field, { min: 0, max }); } catch { return res.status(400).json({ message: "Invalid teacher data." }); } }
  }
  if (req.body.subjects !== undefined && (!Array.isArray(req.body.subjects) || req.body.subjects.length > 50 || req.body.subjects.some((value) => typeof value !== "string" || value.length > 80))) return res.status(400).json({ message: "Subjects are invalid." });
  ["code", "name", "department", "email", "phone", "cabin"].forEach((field) => {
    if (req.body[field] !== undefined) teacher[field] = req.body[field];
  });
  if (req.body.email !== undefined) teacher.email = String(req.body.email).trim().toLowerCase();
  if (req.body.password !== undefined) {
    teacher.password = bcrypt.hashSync(req.body.password, 12);
    teacher.passwordVersion = (teacher.passwordVersion || 0) + 1;
    revokeSessionsForUser(db, teacher.id);
  }
  if (Array.isArray(req.body.subjects)) teacher.subjects = req.body.subjects;
  await writeDb(db);
  const { password, ...safeTeacher } = teacher;
  res.json({ teacher: safeTeacher });
});

teachersRouter.delete("/:id", requireAuth, requireAdmin, async (req, res) => {
  const db = await readDb();
  const id = req.params.id;
  if (!(db.teachers || []).some((item) => item.id === id)) return res.status(404).json({ message: "Teacher not found." });
  // Deleting a teacher who was an HOD left department.hodId pointing at a
  // ghost. requireHod resolves the HOD by scanning departments for hodId, so
  // the stale pointer also meant the next account to reuse that id would
  // silently inherit HOD privileges.
  (db.departments || []).forEach((department) => { if (department.hodId === id) { department.hodId = ""; department.temporaryHod = false; } });
  db.teachers = (db.teachers || []).filter((item) => item.id !== id);
  if (db.notificationReads) delete db.notificationReads[id];
  revokeSessionsForUser(db, id);
  await writeDb(db);
  res.json({ ok: true });
});
