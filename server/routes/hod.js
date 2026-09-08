import { Router } from "express";
import crypto from "node:crypto";
import { readDb, writeDb } from "../db/fileStore.js";
import { requireAuth, requireHod } from "../middleware/auth.js";
import { enumValue, requiredText, validateKeys } from "../services/validation.js";

export const hodRouter = Router();

function departmentFor(db, req) { return (db.departments || []).find((item) => item.id === req.user.hodDepartmentId); }
function studentPublic(student) { return { id: student.id, name: student.name, rollNumber: student.rollNumber, className: student.className, department: student.department, email: student.email, phone: student.phone || "", approvalStatus: student.approvalStatus || "approved" }; }
function complaintPublic(item, db) { const student = (db.students || []).find((s) => s.id === item.studentId); return { ...item, studentName: student?.name || "Unknown student", rollNumber: student?.rollNumber || "-", className: student?.className || "-" }; }

hodRouter.get("/overview", requireAuth, requireHod, async (req, res) => {
  const db = await readDb(); const department = departmentFor(db, req); if (!department) return res.status(404).json({ message: "HOD department not found." });
  const students = (db.students || []).filter((item) => item.department === department.name);
  const teachers = (db.teachers || []).filter((item) => item.department === department.name || item.id === department.hodId);
  const complaints = (db.complaints || []).filter((item) => students.some((s) => s.id === item.studentId)).map((item) => complaintPublic(item, db));
  const notices = (db.notices || []).filter((item) => item.departmentId === department.id);
  res.json({ department, hod: { id: req.user.id, name: req.user.name, email: req.user.email }, students: students.map(studentPublic), teachers: teachers.map(({ password, ...teacher }) => teacher), complaints, notices });
});

hodRouter.post("/notices", requireAuth, requireHod, async (req, res) => {
  try { validateKeys(req.body || {}, ["title", "body", "category"]); } catch { return res.status(400).json({ message: "Invalid notice data." }); }
  const db = await readDb(); const department = departmentFor(db, req); if (!department) return res.status(404).json({ message: "HOD department not found." });
  let title, body; try { title = requiredText(req.body.title, "Title", { max: 160 }); body = requiredText(req.body.body, "Notice body", { max: 3000 }); } catch { return res.status(400).json({ message: "Notice title and body are required." }); }
  db.notices ||= []; const notice = { id: crypto.randomUUID(), title, body, category: ["academic", "exam", "event", "emergency"].includes(req.body.category) ? req.body.category : "academic", departmentId: department.id, departmentName: department.name, teacherId: req.user.id, teacherName: req.user.name, createdAt: new Date().toISOString() }; db.notices.unshift(notice); await writeDb(db); res.status(201).json({ notice });
});

hodRouter.put("/complaints/:id", requireAuth, requireHod, async (req, res) => {
  const db = await readDb(); const department = departmentFor(db, req); if (!department) return res.status(404).json({ message: "HOD department not found." }); db.students ||= []; db.complaints ||= [];
  const complaint = db.complaints.find((item) => item.id === req.params.id); const student = complaint && db.students.find((item) => item.id === complaint.studentId);
  if (!complaint || !student || student.department !== department.name) return res.status(404).json({ message: "Department complaint not found." });
  try { validateKeys(req.body || {}, ["status", "priority", "response"]); if (req.body.status !== undefined) enumValue(req.body.status, "Status", ["pending", "in-progress", "resolved"]); if (req.body.priority !== undefined) enumValue(req.body.priority, "Priority", ["low", "medium", "high"]); if (req.body.response !== undefined) requiredText(req.body.response, "Response", { min: 0, max: 3000 }); } catch { return res.status(400).json({ message: "Invalid complaint update." }); }
  ["status", "priority", "response"].forEach((field) => { if (req.body[field] !== undefined) complaint[field] = req.body[field]; }); complaint.updatedAt = new Date().toISOString(); complaint.updatedBy = req.user.id; await writeDb(db); res.json({ complaint: complaintPublic(complaint, db) });
});
