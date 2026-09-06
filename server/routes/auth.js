import bcrypt from "bcryptjs";
import { Router } from "express";
import { makeId, readDb, writeDb } from "../db/fileStore.js";
import { requireAuth, signToken } from "../middleware/auth.js";
import { publicStudent } from "../services/attendanceService.js";
import { rateConfig, rateLimit } from "../middleware/rateLimit.js";
import { PASSWORD_REQUIREMENTS, requiredText, validEmail, validPassword, validateKeys } from "../services/validation.js";

export const authRouter = Router();
const loginIpConfig = rateConfig("AUTH_LOGIN_IP", { windowMs: 15 * 60 * 1000, limit: 20, backoffBaseMs: 1000, backoffMaxMs: 60 * 1000 });
const loginAccountConfig = rateConfig("AUTH_LOGIN_ACCOUNT", { windowMs: 15 * 60 * 1000, limit: 8, backoffBaseMs: 2000, backoffMaxMs: 5 * 60 * 1000 });
const signupConfig = rateConfig("AUTH_SIGNUP", { windowMs: 60 * 60 * 1000, limit: 10, backoffBaseMs: 2000, backoffMaxMs: 10 * 60 * 1000 });

authRouter.post("/login", rateLimit({
  ...loginIpConfig,
  message: "Too many login attempts for this account. Please try again later.",
  keyGenerator: (req) => {
    const email = String(req.body?.email || "").trim().toLowerCase();
    return `${req.ip || req.socket.remoteAddress || "unknown"}:${email || "unknown"}`;
  }
}), rateLimit({
  ...loginAccountConfig,
  keyGenerator: (req) => String(req.body?.email || "unknown").trim().toLowerCase(),
  message: "Too many login attempts for this account. Please try again later."
}), async (req, res) => {
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
    return res.status(400).json({ message: "Invalid login request." });
  }
  try { validateKeys(req.body, ["email", "password", "role"]); } catch { return res.status(400).json({ message: "Invalid login request." }); }
  const { email, password, role } = req.body;
  if (!validEmail(email) || !validPassword(password) || !["admin", "teacher", "student"].includes(role)) {
    return res.status(401).json({ message: "Invalid email, password, or role." });
  }
  const db = await readDb();
  let collection;
  if (role === "admin") collection = db.admins;
  else if (role === "teacher") collection = db.teachers || [];
  else collection = db.students;
  
  const user = collection.find((item) => String(item.email || "").toLowerCase() === String(email).trim().toLowerCase());

  if (!user || !user.password || !bcrypt.compareSync(String(password), user.password)) {
    return res.status(401).json({ message: "Invalid email, password, or role." });
  }
  if (role === "student" && user.approvalStatus && user.approvalStatus !== "approved") {
    return res.status(403).json({ message: "Student ID is not approved by admin yet." });
  }

  const userRole = role === "admin" ? "admin" : role === "teacher" ? "teacher" : "student";
  const token = signToken({ ...user, role: userRole });
  const safeUser =
    userRole === "student"
      ? { ...publicStudent(user, db.attendance), role: userRole }
      : userRole === "teacher"
      ? { id: user.id, name: user.name, email: user.email, code: user.code, department: user.department, role: userRole }
      : { id: user.id, name: user.name, email: user.email, role: userRole };

  res.json({ token, user: safeUser });
});

authRouter.post("/student-request", rateLimit({
  ...signupConfig,
  message: "Too many registration requests. Please try again later."
}), async (req, res) => {
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) return res.status(400).json({ message: "Invalid registration request." });
  try { validateKeys(req.body, ["name", "rollNumber", "email", "password", "className", "department", "phone", "guardian", "graduationYear"]); } catch { return res.status(400).json({ message: "Invalid registration request." }); }
  const db = await readDb();
  db.pendingStudents ||= [];
  const email = String(req.body.email || "").trim().toLowerCase();
  const rollNumber = String(req.body.rollNumber || "").trim();

  if (!validEmail(email) || !validPassword(req.body.password)) {
    return res.status(400).json({ message: `Name, roll number, email, and a ${PASSWORD_REQUIREMENTS.toLowerCase()} are required.` });
  }
  let name;
  try { name = requiredText(req.body.name, "Name", { max: 120 }); } catch { return res.status(400).json({ message: "Name is invalid." }); }
  if (!rollNumber || rollNumber.length > 40) return res.status(400).json({ message: "Roll number is invalid." });
  for (const [field, max] of [["className", 80], ["department", 100], ["phone", 30], ["guardian", 120], ["graduationYear", 10]]) {
    if (req.body[field] !== undefined) { try { requiredText(req.body[field], field, { min: 0, max }); } catch { return res.status(400).json({ message: "Invalid registration request." }); } }
  }

  const emailExists = db.students.some((student) => student.email.toLowerCase() === email);
  const pendingExists = db.pendingStudents.some((student) => student.email.toLowerCase() === email);
  if (emailExists || pendingExists) {
    return res.status(409).json({ message: "This email already has an account or pending request." });
  }

  const request = {
    id: makeId("req"),
    name,
    rollNumber,
    className: req.body.className || "CSE 3A",
    department: req.body.department || "Computer Science",
    email,
    password: bcrypt.hashSync(req.body.password, 12),
    phone: req.body.phone || "",
    guardian: req.body.guardian || "",
    graduationYear: req.body.graduationYear || "2028",
    approvalStatus: "pending",
    createdAt: new Date().toISOString()
  };

  db.pendingStudents.unshift(request);
  await writeDb(db);
  res.status(201).json({
    success: true,
    message: "Student ID request sent to admin for approval.",
    request: {
      id: request.id,
      name: request.name,
      rollNumber: request.rollNumber,
      email: request.email,
      approvalStatus: request.approvalStatus
    }
  });
});

authRouter.post("/change-password", requireAuth, async (req, res) => {
  try { validateKeys(req.body || {}, ["currentPassword", "newPassword"]); } catch { return res.status(400).json({ message: "Invalid password change request." }); }
  const { currentPassword, newPassword } = req.body;
  if (!validPassword(currentPassword) || !validPassword(newPassword)) {
    return res.status(400).json({
      message: `Current password and a new ${PASSWORD_REQUIREMENTS.toLowerCase()} are required.`
    });
  }

  const db = await readDb();
  let collection;
  if (req.user.role === "admin") collection = db.admins;
  else if (req.user.role === "teacher") collection = db.teachers || [];
  else collection = db.students;

  const account = (collection || []).find((item) => item.id === req.user.id);
  if (!account || !account.password) {
    return res.status(404).json({ message: "Account not found." });
  }

  if (!bcrypt.compareSync(String(currentPassword), account.password)) {
    return res.status(401).json({ message: "Current password is incorrect." });
  }

  if (bcrypt.compareSync(String(newPassword), account.password)) {
    return res.status(400).json({ message: "New password must be different from the current password." });
  }

  account.password = bcrypt.hashSync(String(newPassword), 12);
  account.passwordVersion = (account.passwordVersion || 0) + 1;
  await writeDb(db);

  res.json({ success: true, message: "Password updated. Please sign in again on this device." });
});

authRouter.get("/me", requireAuth, async (req, res) => {
  const db = await readDb();
  if (req.user.role === "admin") {
    const admin = db.admins.find((item) => item.id === req.user.id);
    if (!admin) return res.status(404).json({ message: "User not found." });
    return res.json({ user: { id: admin.id, name: admin.name, email: admin.email, role: "admin" } });
  }
  
  if (req.user.role === "teacher") {
    const teacher = (db.teachers || []).find((item) => item.id === req.user.id);
    if (!teacher) return res.status(404).json({ message: "User not found." });
    return res.json({ user: { id: teacher.id, name: teacher.name, email: teacher.email, code: teacher.code, department: teacher.department, role: "teacher" } });
  }

  const student = db.students.find((item) => item.id === req.user.id);
  if (!student) return res.status(404).json({ message: "User not found." });
  res.json({ user: { ...publicStudent(student, db.attendance), role: "student" } });
});
