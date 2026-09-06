import bcrypt from "bcryptjs";
import { Router } from "express";
import { makeId, readDb, writeDb } from "../db/fileStore.js";
import { requireAdmin, requireAuth } from "../middleware/auth.js";
import { publicStudent } from "../services/attendanceService.js";
import { PASSWORD_REQUIREMENTS, requiredText, validEmail, validPassword, validateKeys } from "../services/validation.js";

export const studentsRouter = Router();

studentsRouter.get("/", requireAuth, async (req, res) => {
  const db = await readDb();

  if (req.user.role !== "admin") {
    const student = db.students.find((item) => item.id === req.user.id);
    if (!student) return res.status(404).json({ message: "Student not found." });
    return res.json({ students: [publicStudent(student, db.attendance)] });
  }

  const q = String(req.query.q || "").toLowerCase();
  const className = req.query.className;
  const department = req.query.department;
  let students = db.students;

  if (q) {
    students = students.filter((student) =>
      [student.name, student.rollNumber, student.email].some((value) =>
        String(value).toLowerCase().includes(q)
      )
    );
  }
  if (className) students = students.filter((student) => student.className === className);
  if (department) students = students.filter((student) => student.department === department);

  res.json({ students: students.map((student) => publicStudent(student, db.attendance)) });
});

studentsRouter.post("/me/status-request", requireAuth, async (req, res) => {
  if (req.user.role !== "student") return res.status(403).json({ message: "Only students can request a status review." });
  const db = await readDb();
  const student = db.students.find((item) => item.id === req.user.id);
  if (!student) return res.status(404).json({ message: "Student not found." });
  try { validateKeys(req.body || {}, ["requestedStatus", "reason"]); } catch { return res.status(400).json({ message: "Invalid status request." }); }
  const requestedStatus = String(req.body.requestedStatus || "").trim().toLowerCase();
  if (!["pending", "approved", "rejected"].includes(requestedStatus)) {
    return res.status(400).json({ message: "Choose a valid requested status." });
  }
  if (typeof req.body.reason !== "string" || req.body.reason.length > 1000) return res.status(400).json({ message: "Reason is invalid." });
  student.statusUpdateRequest = {
    requestedStatus,
    reason: String(req.body.reason || "").trim(),
    createdAt: new Date().toISOString(),
    status: "open"
  };
  await writeDb(db);
  res.status(201).json({ success: true, message: "Status update request sent to the administration.", request: student.statusUpdateRequest });
});

studentsRouter.get("/pending", requireAuth, requireAdmin, async (_req, res) => {
  const db = await readDb();
  db.pendingStudents ||= [];
  res.json({
    requests: db.pendingStudents
      .filter((request) => request.approvalStatus === "pending")
      .map(({ password, ...safeRequest }) => safeRequest)
  });
});

studentsRouter.post("/pending/:id/approve", requireAuth, requireAdmin, async (req, res) => {
  const db = await readDb();
  db.pendingStudents ||= [];
  const request = db.pendingStudents.find((item) => item.id === req.params.id);
  if (!request) return res.status(404).json({ message: "Student request not found." });
  if (request.approvalStatus !== "pending") return res.status(409).json({ message: "Request is already processed." });

  const student = {
    id: makeId("stu"),
    name: request.name,
    rollNumber: request.rollNumber,
    className: request.className,
    department: request.department,
    email: request.email,
    password: request.password,
    phone: request.phone || "",
    guardian: request.guardian || "",
    graduationYear: request.graduationYear || "2028",
    approvalStatus: "approved",
    approvedAt: new Date().toISOString()
  };

  db.students.push(student);
  request.approvalStatus = "approved";
  request.approvedStudentId = student.id;
  request.approvedAt = student.approvedAt;
  await writeDb(db);
  res.json({ success: true, message: "Student ID approved.", student: publicStudent(student, db.attendance) });
});

studentsRouter.post("/pending/:id/reject", requireAuth, requireAdmin, async (req, res) => {
  const db = await readDb();
  db.pendingStudents ||= [];
  const request = db.pendingStudents.find((item) => item.id === req.params.id);
  if (!request) return res.status(404).json({ message: "Student request not found." });
  request.approvalStatus = "rejected";
  request.rejectedAt = new Date().toISOString();
  request.rejectReason = req.body.reason || "";
  await writeDb(db);
  res.json({ success: true, message: "Student request rejected." });
});

studentsRouter.post("/", requireAuth, requireAdmin, async (req, res) => {
  const db = await readDb();
  try { validateKeys(req.body || {}, ["name", "rollNumber", "className", "department", "email", "password", "phone", "guardian", "graduationYear"]); } catch { return res.status(400).json({ message: "Invalid student data." }); }
  if (!validEmail(req.body.email)) return res.status(400).json({ message: "Email is invalid." });
  let name;
  try { name = requiredText(req.body.name, "Name", { max: 120 }); } catch { return res.status(400).json({ message: "Name is invalid." }); }
  if (!validPassword(req.body.password)) {
    return res.status(400).json({ message: `A ${PASSWORD_REQUIREMENTS.toLowerCase()} is required when creating a student.` });
  }
  const student = {
    id: makeId("stu"),
    name,
    rollNumber: req.body.rollNumber,
    className: req.body.className,
    department: req.body.department,
    email: req.body.email,
    password: bcrypt.hashSync(req.body.password, 12),
    passwordVersion: 0,
    phone: req.body.phone || "",
    guardian: req.body.guardian || "",
    graduationYear: req.body.graduationYear || "2028",
    approvalStatus: "approved"
  };
  db.students.push(student);
  await writeDb(db);
  res.status(201).json({ student: publicStudent(student, db.attendance) });
});

studentsRouter.put("/:id", requireAuth, requireAdmin, async (req, res) => {
  const db = await readDb();
  try { validateKeys(req.body || {}, ["name", "rollNumber", "className", "department", "email", "password", "phone", "guardian", "graduationYear"]); } catch { return res.status(400).json({ message: "Invalid student data." }); }
  if (req.body.email !== undefined && !validEmail(req.body.email)) return res.status(400).json({ message: "Email is invalid." });
  const student = db.students.find((item) => item.id === req.params.id);
  if (!student) return res.status(404).json({ message: "Student not found." });

  [
    "name",
    "rollNumber",
    "className",
    "department",
    "email",
    "phone",
    "guardian",
    "graduationYear"
  ].forEach((field) => {
    if (req.body[field] !== undefined) student[field] = req.body[field];
  });
  if (req.body.password !== undefined) {
    if (!validPassword(req.body.password)) return res.status(400).json({ message: PASSWORD_REQUIREMENTS });
    student.password = bcrypt.hashSync(req.body.password, 12);
    student.passwordVersion = (student.passwordVersion || 0) + 1;
  }

  await writeDb(db);
  res.json({ student: publicStudent(student, db.attendance) });
});

studentsRouter.delete("/:id", requireAuth, requireAdmin, async (req, res) => {
  const db = await readDb();
  db.students = db.students.filter((item) => item.id !== req.params.id);
  db.attendance = db.attendance.filter((item) => item.studentId !== req.params.id);
  await writeDb(db);
  res.json({ ok: true });
});
