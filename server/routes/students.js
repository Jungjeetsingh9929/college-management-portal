import bcrypt from "bcryptjs";
import { Router } from "express";
import { makeId, readDb, writeDb } from "../db/fileStore.js";
import { requireAdmin, requireAuth } from "../middleware/auth.js";
import { publicStudent } from "../services/attendanceService.js";

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
      [student.name, student.rollNumber, student.email, student.cardUid, student.fingerprintId].some((value) =>
        String(value).toLowerCase().includes(q)
      )
    );
  }
  if (className) students = students.filter((student) => student.className === className);
  if (department) students = students.filter((student) => student.department === department);

  res.json({ students: students.map((student) => publicStudent(student, db.attendance)) });
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
    cardUid: request.cardUid || "",
    fingerprintId: request.fingerprintId || "",
    faceImageUrl: request.faceImageUrl || "",
    faceDescriptor: Array.isArray(request.faceDescriptor) ? request.faceDescriptor : [],
    faceEnrolled: Boolean(request.faceEnrolled),
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
  if (!req.body.password) {
    return res.status(400).json({ message: "Password is required when creating a student." });
  }
  const student = {
    id: makeId("stu"),
    name: req.body.name,
    rollNumber: req.body.rollNumber,
    className: req.body.className,
    department: req.body.department,
    email: req.body.email,
    password: bcrypt.hashSync(req.body.password, 10),
    cardUid: req.body.cardUid || "",
    fingerprintId: req.body.fingerprintId || "",
    faceImageUrl: req.body.faceImageUrl || "",
    faceDescriptor: Array.isArray(req.body.faceDescriptor) ? req.body.faceDescriptor : [],
    faceEnrolled: Boolean(req.body.faceEnrolled || req.body.faceImageUrl || req.body.faceDescriptor?.length),
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
  const student = db.students.find((item) => item.id === req.params.id);
  if (!student) return res.status(404).json({ message: "Student not found." });

  [
    "name",
    "rollNumber",
    "className",
    "department",
    "email",
    "cardUid",
    "fingerprintId",
    "faceImageUrl",
    "faceEnrolled",
    "phone",
    "guardian",
    "graduationYear"
  ].forEach((field) => {
    if (req.body[field] !== undefined) student[field] = req.body[field];
  });
  if (Array.isArray(req.body.faceDescriptor)) student.faceDescriptor = req.body.faceDescriptor;
  if (req.body.faceImageUrl || req.body.faceDescriptor?.length) student.faceEnrolled = true;
  if (req.body.password) student.password = bcrypt.hashSync(req.body.password, 10);

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
