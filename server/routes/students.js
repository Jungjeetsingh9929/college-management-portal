import bcrypt from "bcryptjs";
import { Router } from "express";
import { makeId, readDb, writeDb } from "../db/fileStore.js";
import { requireAdmin, requireAuth } from "../middleware/auth.js";
import { publicStudent } from "../services/attendanceService.js";
import { PASSWORD_REQUIREMENTS, requiredText, validEmail, validPassword, validateKeys } from "../services/validation.js";
import { emailInUse, normalizeEmail, rollNumberInUse } from "../services/accountService.js";
import { revokeSessionsForUser } from "../middleware/auth.js";
import { deletePhotoBlobs, detachPhotosForStudent } from "../services/photoService.js";
import { collectSubmissionBlobs, deleteAssignmentBlobs } from "../services/assignmentService.js";
import { validateProfileUpdate } from "../services/profileValidation.js";

// Optional free-text profile fields shared by the create and update routes.
// Every one of these used to be copied straight out of the request body with
// no type check, so a JSON object/array/number landed in the stored record
// and broke every consumer that assumed a string.
const OPTIONAL_STUDENT_FIELDS = [["className", 80], ["department", 100], ["phone", 30], ["guardian", 120], ["graduationYear", 10]];
function invalidOptionalField(body) {
  for (const [field, max] of OPTIONAL_STUDENT_FIELDS) {
    if (body[field] === undefined) continue;
    if (typeof body[field] !== "string" || body[field].trim().length > max) return field;
  }
  return null;
}

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

  const total = students.length; const page = Math.max(1, Math.min(10000, Number.parseInt(req.query.page || "1", 10) || 1)); const perPage = Math.max(1, Math.min(100, Number.parseInt(req.query.perPage || "100", 10) || 100)); const paged = students.slice((page - 1) * perPage, page * perPage);
  res.json({ students: paged.map((student) => publicStudent(student, db.attendance)), pagination: { page, perPage, total, pages: Math.ceil(total / perPage) } });
});

// Student self-service profile. The student is always resolved from the
// verified token (req.user.id) - never from the body or a URL parameter - and
// requireAuth runs first, so a missing/invalid token is a 401 and an
// authenticated teacher/admin is a 403.
function requireStudent(req, res, next) {
  if (req.user?.role !== "student") return res.status(403).json({ message: "Only students can use this profile." });
  next();
}

studentsRouter.get("/me/profile", requireAuth, requireStudent, async (req, res) => {
  const db = await readDb();
  const student = db.students.find((item) => item.id === req.user.id);
  if (!student) return res.status(404).json({ message: "Student not found." });
  res.json({ student: publicStudent(student, db.attendance) });
});

studentsRouter.put("/me/profile", requireAuth, requireStudent, async (req, res) => {
  const result = validateProfileUpdate(req.body);
  if (!result.updates) return res.status(400).json({ message: result.message, ...(result.field ? { field: result.field } : {}) });
  const db = await readDb();
  const student = db.students.find((item) => item.id === req.user.id);
  if (!student) return res.status(404).json({ message: "Student not found." });
  Object.assign(student, result.updates);
  await writeDb(db);
  res.json({ student: publicStudent(student, db.attendance) });
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
  if (emailInUse(db, request.email)) return res.status(409).json({ message: "This email already has an account." });
  if (rollNumberInUse(db, request.rollNumber)) return res.status(409).json({ message: "This roll number is already assigned to another student." });

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
  request.rejectReason = typeof req.body?.reason === "string" ? req.body.reason.trim().slice(0, 300) : "";
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
  let rollNumber;
  try { rollNumber = requiredText(req.body.rollNumber, "Roll number", { max: 40 }); } catch { return res.status(400).json({ message: "Roll number is invalid." }); }
  const badField = invalidOptionalField(req.body);
  if (badField) return res.status(400).json({ message: `${badField} is invalid.` });
  // Email and roll number are the two identifiers every other view keys off
  // (login, password reset, attendance sheets, reports). Nothing used to stop
  // an admin from creating a second account on top of an existing user's
  // email, or two students sharing a roll number.
  if (emailInUse(db, req.body.email)) return res.status(409).json({ message: "This email already has an account." });
  if (rollNumberInUse(db, rollNumber)) return res.status(409).json({ message: "This roll number is already assigned to another student." });
  const student = {
    id: makeId("stu"),
    name,
    rollNumber,
    className: req.body.className,
    department: req.body.department,
    email: normalizeEmail(req.body.email),
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
  if (req.body.name !== undefined) { try { requiredText(req.body.name, "Name", { max: 120 }); } catch { return res.status(400).json({ message: "Name is invalid." }); } }
  if (req.body.rollNumber !== undefined) { try { requiredText(req.body.rollNumber, "Roll number", { max: 40 }); } catch { return res.status(400).json({ message: "Roll number is invalid." }); } }
  const badField = invalidOptionalField(req.body);
  if (badField) return res.status(400).json({ message: `${badField} is invalid.` });
  if (req.body.email !== undefined && emailInUse(db, req.body.email, { ignoreId: student.id })) return res.status(409).json({ message: "This email already has an account." });
  if (req.body.rollNumber !== undefined && rollNumberInUse(db, req.body.rollNumber, { ignoreId: student.id })) return res.status(409).json({ message: "This roll number is already assigned to another student." });

  [
    "name",
    "rollNumber",
    "className",
    "department",
    "phone",
    "guardian",
    "graduationYear"
  ].forEach((field) => {
    if (req.body[field] !== undefined) student[field] = req.body[field];
  });
  if (req.body.email !== undefined) student.email = normalizeEmail(req.body.email);
  if (req.body.password !== undefined) {
    if (!validPassword(req.body.password)) return res.status(400).json({ message: PASSWORD_REQUIREMENTS });
    student.password = bcrypt.hashSync(req.body.password, 12);
    student.passwordVersion = (student.passwordVersion || 0) + 1;
    // Bumping passwordVersion invalidates access tokens on their next
    // request, but the refresh tokens stayed live and would mint fresh
    // access tokens for whoever held them.
    revokeSessionsForUser(db, student.id);
  }

  await writeDb(db);
  res.json({ student: publicStudent(student, db.attendance) });
});

studentsRouter.patch("/:id/status", requireAuth, requireAdmin, async (req, res) => {
  try { validateKeys(req.body || {}, ["active"]); } catch { return res.status(400).json({ message: "Invalid student status." }); }
  if (typeof req.body.active !== "boolean") return res.status(400).json({ message: "active must be boolean." });
  const db = await readDb(); const student = db.students.find((item) => item.id === req.params.id);
  if (!student) return res.status(404).json({ message: "Student not found." });
  student.active = req.body.active;
  if (student.active === false) revokeSessionsForUser(db, student.id);
  await writeDb(db); res.json({ student: publicStudent(student, db.attendance) });
});

studentsRouter.delete("/:id", requireAuth, requireAdmin, async (req, res) => {
  const db = await readDb();
  const id = req.params.id;
  const existed = db.students.some((item) => item.id === id);
  if (!existed) return res.status(404).json({ message: "Student not found." });
  db.students = db.students.filter((item) => item.id !== id);
  db.attendance = (db.attendance || []).filter((item) => item.studentId !== id);
  // Deleting the account row alone left the student's data scattered across
  // half a dozen collections - and, more importantly, left their refresh
  // tokens live, so a deleted student kept a working session until the token
  // expired. Clean up every collection that keys off studentId.
  db.attendanceCorrections = (db.attendanceCorrections || []).filter((item) => item.requestedBy !== id);
  // Collect this student's submitted assignment files before the completion
  // records pointing at them are filtered out below, same pattern as the
  // photo-blob cleanup just underneath.
  const submissionBlobs = collectSubmissionBlobs((db.assignmentCompletions || []).filter((item) => item.studentId === id));
  db.assignmentCompletions = (db.assignmentCompletions || []).filter((item) => item.studentId !== id);
  db.quizAttempts = (db.quizAttempts || []).filter((item) => item.studentId !== id);
  db.internalMarks = (db.internalMarks || []).filter((item) => item.studentId !== id);
  db.results = (db.results || []).filter((item) => item.studentId !== id);
  db.complaints = (db.complaints || []).filter((item) => item.studentId !== id);
  db.studentFees = (db.studentFees || []).filter((item) => item.studentId !== id);
  db.feeReminders = (db.feeReminders || []).filter((item) => item.studentId !== id);
  if (db.deviceFingerprints) delete db.deviceFingerprints[id];
  if (db.notificationReads) delete db.notificationReads[id];
  const photoBlobs = detachPhotosForStudent(db, id);
  revokeSessionsForUser(db, id);
  await writeDb(db);
  await deletePhotoBlobs(photoBlobs);
  await deleteAssignmentBlobs({ submissionStoredNames: submissionBlobs });
  res.json({ ok: true });
});
