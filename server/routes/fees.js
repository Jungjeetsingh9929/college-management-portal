import { Router } from "express";
import crypto from "node:crypto";
import { readDb, writeDb } from "../db/fileStore.js";
import { requireAdmin, requireAuth, requireHod } from "../middleware/auth.js";
import { sendFeeReminderEmail } from "../services/emailService.js";
import { feeStructures2026, feeStructures2026Notes } from "../db/feeStructures2026.js";

export const feesRouter = Router();

function ensureCollections(db) {
  db.departments ||= [];
  db.students ||= [];
  db.feeStructures ||= [];
  db.studentFees ||= [];
  db.feeReminders ||= [];
  db.notices ||= [];
  db.programFeeStructures ||= feeStructures2026;
  for (const department of db.departments) {
    if (!db.feeStructures.some((item) => item.departmentId === department.id)) {
      db.feeStructures.push({ id: crypto.randomUUID(), departmentId: department.id, departmentName: department.name, academicYear: "2026-27", tuitionFee: 0, hostelFee: 0, examFee: 0, otherFee: 0, dueDate: "", updatedAt: new Date().toISOString() });
    }
  }
  for (const student of db.students) {
    const department = db.departments.find((item) => item.name === student.department);
    const structure = db.feeStructures.find((item) => item.departmentId === department?.id);
    if (department && structure && !db.studentFees.some((item) => item.studentId === student.id)) {
      db.studentFees.push({ id: crypto.randomUUID(), studentId: student.id, departmentId: department.id, amountDue: total(structure), amountPaid: 0, dueDate: structure.dueDate || "", status: "due", updatedAt: new Date().toISOString() });
    }
  }
}
function total(item) { return ["tuitionFee", "hostelFee", "examFee", "otherFee"].reduce((sum, key) => sum + (Number(item[key]) || 0), 0); }
function publicStudentFee(item, db) {
  const student = db.students.find((record) => record.id === item.studentId);
  const due = Math.max(0, Number(item.amountDue) - Number(item.amountPaid || 0));
  return { ...item, studentName: student?.name || "Unknown student", rollNumber: student?.rollNumber || "-", email: student?.email || "", department: student?.department || "", balance: due, status: due <= 0 ? "paid" : item.dueDate && item.dueDate < new Date().toISOString().slice(0, 10) ? "overdue" : "due" };
}
function departmentFor(db, req) { return db.departments.find((item) => item.id === req.user.hodDepartmentId); }

// Published per-program fee sheets for AY 2026-27 (distinct from the editable
// per-department totals below). Any authenticated user can view these.
feesRouter.get("/fees/programs", requireAuth, async (_req, res) => {
  const db = await readDb(); ensureCollections(db);
  res.json({ programs: db.programFeeStructures, academicYear: "2026-27", notes: feeStructures2026Notes });
});

feesRouter.get("/admin/fees", requireAuth, requireAdmin, async (_req, res) => {
  const db = await readDb(); ensureCollections(db); await writeDb(db);
  const studentFees = db.studentFees.map((item) => publicStudentFee(item, db));
  res.json({ structures: db.feeStructures, studentFees, totals: { due: studentFees.reduce((sum, item) => sum + item.balance, 0), studentsWithDue: studentFees.filter((item) => item.balance > 0).length, reminders: db.feeReminders.length } });
});

feesRouter.put("/admin/fees/structures/:departmentId", requireAuth, requireAdmin, async (req, res) => {
  const db = await readDb(); ensureCollections(db);
  const department = db.departments.find((item) => item.id === req.params.departmentId);
  if (!department) return res.status(404).json({ message: "Department not found." });
  const fields = ["academicYear", "tuitionFee", "hostelFee", "examFee", "otherFee", "dueDate"];
  const structure = db.feeStructures.find((item) => item.departmentId === department.id) || { id: crypto.randomUUID(), departmentId: department.id };
  for (const field of fields) if (req.body[field] !== undefined) structure[field] = field.endsWith("Fee") ? Math.max(0, Number(req.body[field]) || 0) : String(req.body[field] || "").slice(0, 30);
  structure.departmentName = department.name; structure.updatedAt = new Date().toISOString();
  if (!db.feeStructures.some((item) => item.id === structure.id)) db.feeStructures.push(structure);
  for (const item of db.studentFees.filter((fee) => fee.departmentId === department.id && Number(fee.amountPaid || 0) === 0)) { item.amountDue = total(structure); item.dueDate = structure.dueDate; item.updatedAt = structure.updatedAt; }
  await writeDb(db); res.json({ structure });
});

feesRouter.patch("/admin/fees/students/:studentId", requireAuth, requireAdmin, async (req, res) => {
  const db = await readDb(); ensureCollections(db); const fee = db.studentFees.find((item) => item.studentId === req.params.studentId);
  if (!fee) return res.status(404).json({ message: "Student fee record not found." });
  if (req.body.amountDue !== undefined) fee.amountDue = Math.max(0, Number(req.body.amountDue) || 0);
  if (req.body.amountPaid !== undefined) fee.amountPaid = Math.max(0, Number(req.body.amountPaid) || 0);
  if (req.body.dueDate !== undefined) fee.dueDate = String(req.body.dueDate || "").slice(0, 20);
  fee.updatedAt = new Date().toISOString(); await writeDb(db); res.json({ fee: publicStudentFee(fee, db) });
});

feesRouter.post("/admin/fees/reminders/:studentId", requireAuth, requireAdmin, async (req, res) => {
  const db = await readDb(); ensureCollections(db); const fee = db.studentFees.find((item) => item.studentId === req.params.studentId); const student = db.students.find((item) => item.id === req.params.studentId);
  if (!fee || !student) return res.status(404).json({ message: "Student fee record not found." });
  const record = { id: crypto.randomUUID(), studentId: student.id, amount: publicStudentFee(fee, db).balance, sentAt: new Date().toISOString(), sentBy: req.user.id, delivery: "pending" };
  const sent = await sendFeeReminderEmail({ to: student.email, name: student.name, amount: record.amount, dueDate: fee.dueDate }); record.delivery = sent ? "email-sent" : "recorded-no-email"; db.feeReminders.unshift(record); await writeDb(db);
  res.status(201).json({ reminder: record, message: sent ? "Fee reminder emailed to the student." : "Fee reminder recorded; SMTP email was not available." });
});

feesRouter.get("/hod/fees", requireAuth, requireHod, async (req, res) => {
  const db = await readDb(); ensureCollections(db); const department = departmentFor(db, req); if (!department) return res.status(404).json({ message: "HOD department not found." });
  const structure = db.feeStructures.find((item) => item.departmentId === department.id); const studentFees = db.studentFees.filter((item) => item.departmentId === department.id).map((item) => publicStudentFee(item, db));
  res.json({ structure, studentFees, totals: { due: studentFees.reduce((sum, item) => sum + item.balance, 0), studentsWithDue: studentFees.filter((item) => item.balance > 0).length } });
});

feesRouter.put("/hod/fees/structure", requireAuth, requireHod, async (req, res) => {
  const db = await readDb(); ensureCollections(db); const department = departmentFor(db, req); if (!department) return res.status(404).json({ message: "HOD department not found." });
  const structure = db.feeStructures.find((item) => item.departmentId === department.id); if (!structure) return res.status(404).json({ message: "Fee structure not found." });
  for (const field of ["academicYear", "tuitionFee", "hostelFee", "examFee", "otherFee", "dueDate"]) if (req.body[field] !== undefined) structure[field] = field.endsWith("Fee") ? Math.max(0, Number(req.body[field]) || 0) : String(req.body[field] || "").slice(0, 30);
  structure.updatedAt = new Date().toISOString(); for (const item of db.studentFees.filter((fee) => fee.departmentId === department.id && Number(fee.amountPaid || 0) === 0)) { item.amountDue = total(structure); item.dueDate = structure.dueDate; }
  await writeDb(db); res.json({ structure });
});

feesRouter.get("/admin/notices", requireAuth, requireAdmin, async (_req, res) => { const db = await readDb(); res.json({ notices: (db.notices || []).slice(0, 100) }); });
feesRouter.post("/admin/notices", requireAuth, requireAdmin, async (req, res) => {
  const db = await readDb(); ensureCollections(db); const title = String(req.body?.title || "").trim().slice(0, 160); const body = String(req.body?.body || "").trim().slice(0, 3000); const departmentId = String(req.body?.departmentId || "");
  if (!title || !body || !db.departments.some((item) => item.id === departmentId)) return res.status(400).json({ message: "Title, message, and department are required." });
  const department = db.departments.find((item) => item.id === departmentId); const notice = { id: crypto.randomUUID(), title, body, category: String(req.body.category || "academic"), departmentId, departmentName: department.name, teacherId: req.user.id, teacherName: req.user.name, createdAt: new Date().toISOString() }; db.notices.unshift(notice); await writeDb(db); res.status(201).json({ notice });
});

export { ensureCollections };
