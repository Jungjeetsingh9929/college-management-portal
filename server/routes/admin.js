import { Router } from "express";
import { readDb } from "../db/fileStore.js";
import { requireAdmin, requireAuth } from "../middleware/auth.js";

export const adminRouter = Router();

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
