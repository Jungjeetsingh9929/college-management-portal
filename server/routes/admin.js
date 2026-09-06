import { Router } from "express";
import crypto from "node:crypto";
import { readDb } from "../db/fileStore.js";
import { requireAdmin, requireAuth } from "../middleware/auth.js";
import { requiredText, validateKeys } from "../services/validation.js";

export const adminRouter = Router();

adminRouter.get("/security", requireAuth, requireAdmin, async (req, res) => {
  const db = await readDb(); const logs = db.auditLogs || []; const from = req.query.from ? new Date(String(req.query.from)) : null; const to = req.query.to ? new Date(`${String(req.query.to)}T23:59:59.999Z`) : null; const user = String(req.query.user || "").trim().toLowerCase(); const eventType = String(req.query.eventType || "").trim().toLowerCase(); const severity = String(req.query.severity || "").trim().toLowerCase();
  const filtered = logs.filter((item) => { const date = new Date(item.timestamp); return (!from || date >= from) && (!to || date <= to) && (!user || `${item.userId || ""} ${item.target || ""}`.toLowerCase().includes(user)) && (!eventType || item.action.toLowerCase().includes(eventType)) && (!severity || item.severity === severity); });
  const activeSessions = Object.values(db.refreshTokens || {}).filter((item) => !item.revokedAt && new Date(item.expiresAt) > new Date()).length; const failed = logs.filter((item) => item.success === false && item.action.startsWith("auth.")).length; const lockouts = logs.filter((item) => item.success === false && item.action.includes("429")).length; res.json({ summary: { failedLoginAttempts: failed, activeSessions, recentLogins: logs.filter((item) => item.action === "auth.login.success").length, suspiciousActivity: logs.filter((item) => item.severity === "critical" || item.success === false).length, accountLockouts: lockouts }, auditLogs: filtered.slice(0, 500), total: filtered.length });
});

adminRouter.get("/overview", requireAuth, requireAdmin, async (_req, res) => {
  const db = await readDb(); db.departments ||= []; db.classrooms ||= []; db.assignments ||= []; db.assignmentCompletions ||= [];
  const today = new Date().toISOString().slice(0, 10); const schedulesToday = (db.schedules || []).filter((item) => item.day === new Date().toLocaleDateString("en-US", { weekday: "long" }));
  const departments = [...new Set([...(db.departments || []).map((item) => item.name), ...(db.students || []).map((item) => item.department), ...(db.teachers || []).map((item) => item.department)].filter(Boolean))].sort();
  const faculty = (db.teachers || []).map((teacher) => ({ id: teacher.id, name: teacher.name, code: teacher.code, department: teacher.department, workload: (db.schedules || []).filter((item) => String(item.teacher || "").toLowerCase().includes(String(teacher.code || "").toLowerCase())).length }));
  const recentActivity = [...(db.notices || []).map((item) => ({ type: "notice", title: item.title, createdAt: item.createdAt })), ...(db.attendance || []).map((item) => ({ type: "attendance", title: "Attendance marked", createdAt: item.createdAt || item.date }))].filter((item) => item.createdAt).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 10);
  res.json({ totals: { students: (db.students || []).length, faculty: (db.teachers || []).length, departments: departments.length, subjects: (db.subjects || []).length, classrooms: (db.classrooms || []).length, todaysClasses: schedulesToday.length }, departments, faculty, classrooms: db.classrooms, todaysClasses: schedulesToday, assignmentStats: { total: db.assignments.length, completed: db.assignmentCompletions.length, overdue: db.assignments.filter((item) => item.dueDate < today).length }, examinationStats: { scheduled: (db.examinations || []).length, publishedResults: (db.results || []).length }, recentActivity, securityAlerts: [{ key: "inactive-students", label: "Inactive student accounts", count: (db.students || []).filter((item) => item.active === false).length }, { key: "pending-requests", label: "Pending student approvals", count: (db.pendingStudents || []).filter((item) => item.approvalStatus === "pending").length }] });
});

adminRouter.get("/departments", requireAuth, requireAdmin, async (_req, res) => { const db = await readDb(); res.json({ departments: db.departments || [] }); });
adminRouter.post("/departments", requireAuth, requireAdmin, async (req, res) => { try { validateKeys(req.body || {}, ["name", "hodId"]); const name = requiredText(req.body.name, "Department", { max: 120 }); const db = await readDb(); db.departments ||= []; if (db.departments.some((item) => item.name.toLowerCase() === name.toLowerCase())) return res.status(409).json({ message: "Department already exists." }); const department = { id: crypto.randomUUID(), name, hodId: String(req.body.hodId || "") }; db.departments.push(department); const teachers = db.teachers || []; const hod = teachers.find((item) => item.id === department.hodId); if (hod) hod.department = name; const { writeDb } = await import("../db/fileStore.js"); await writeDb(db); res.status(201).json({ department }); } catch { res.status(400).json({ message: "Invalid department data." }); } });
adminRouter.put("/departments/:id", requireAuth, requireAdmin, async (req, res) => { try { validateKeys(req.body || {}, ["name", "hodId"]); const db = await readDb(); db.departments ||= []; const department = db.departments.find((item) => item.id === req.params.id); if (!department) return res.status(404).json({ message: "Department not found." }); department.name = requiredText(req.body.name, "Department", { max: 120 }); department.hodId = String(req.body.hodId || ""); const { writeDb } = await import("../db/fileStore.js"); await writeDb(db); res.json({ department }); } catch { res.status(400).json({ message: "Invalid department data." }); } });

adminRouter.get("/classrooms", requireAuth, requireAdmin, async (_req, res) => { const db = await readDb(); res.json({ classrooms: db.classrooms || [] }); });
adminRouter.post("/classrooms", requireAuth, requireAdmin, async (req, res) => { try { validateKeys(req.body || {}, ["name", "building", "capacity", "available"]); const name = requiredText(req.body.name, "Classroom", { max: 80 }); const building = requiredText(req.body.building, "Building", { max: 80 }); const capacity = Number(req.body.capacity); if (!Number.isInteger(capacity) || capacity < 1 || capacity > 500) throw new Error("capacity"); const db = await readDb(); db.classrooms ||= []; const classroom = { id: crypto.randomUUID(), name, building, capacity, available: req.body.available !== false }; db.classrooms.push(classroom); const { writeDb } = await import("../db/fileStore.js"); await writeDb(db); res.status(201).json({ classroom }); } catch { res.status(400).json({ message: "Invalid classroom data." }); } });
adminRouter.put("/classrooms/:id", requireAuth, requireAdmin, async (req, res) => { try { validateKeys(req.body || {}, ["name", "building", "capacity", "available"]); const db = await readDb(); db.classrooms ||= []; const classroom = db.classrooms.find((item) => item.id === req.params.id); if (!classroom) return res.status(404).json({ message: "Classroom not found." }); Object.assign(classroom, { name: requiredText(req.body.name, "Classroom", { max: 80 }), building: requiredText(req.body.building, "Building", { max: 80 }), capacity: Number(req.body.capacity), available: req.body.available !== false }); if (!Number.isInteger(classroom.capacity) || classroom.capacity < 1 || classroom.capacity > 500) throw new Error("capacity"); const { writeDb } = await import("../db/fileStore.js"); await writeDb(db); res.json({ classroom }); } catch { res.status(400).json({ message: "Invalid classroom data." }); } });

adminRouter.get("/assignments", requireAuth, requireAdmin, async (req, res) => {
  const db = await readDb();
  db.assignments ||= [];
  db.assignmentCompletions ||= [];
  db.students ||= [];

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const assignments = db.assignments.map(a => {
    const due = new Date(a.dueDate);
    due.setHours(0, 0, 0, 0);
    const overdue = due < today;

    const classStudents = db.students.filter(s => s.className === a.className);
    const totalStudentsInClass = classStudents.length;

    const completedCount = db.assignmentCompletions.filter(c => c.assignmentId === a.id).length;

    return {
      ...a,
      overdue,
      completedCount,
      totalStudentsInClass,
      completionRate: totalStudentsInClass > 0 ? Math.round((completedCount / totalStudentsInClass) * 100) : 0
    };
  });

  res.json({ assignments });
});
