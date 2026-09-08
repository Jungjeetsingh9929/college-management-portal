import { Router } from "express";
import { makeId, readDb, writeDb } from "../db/fileStore.js";
import { requireAuth, requireStaff } from "../middleware/auth.js";
import { enumValue, requiredText, validateKeys } from "../services/validation.js";

export const complaintsRouter = Router();

function publicComplaint(complaint, db) {
  const student = db.students.find((item) => item.id === complaint.studentId);
  return {
    ...complaint,
    studentName: student?.name || "Unknown student",
    rollNumber: student?.rollNumber || "-",
    className: student?.className || "-"
  };
}

complaintsRouter.get("/", requireAuth, async (req, res) => {
  const db = await readDb();
  db.complaints ||= [];
  let complaints = db.complaints;

  if (req.user.role === "student") {
    complaints = complaints.filter((item) => item.studentId === req.user.id);
  }
  if (req.query.status) {
    complaints = complaints.filter((item) => item.status === req.query.status);
  }
  if (req.query.priority) {
    complaints = complaints.filter((item) => item.priority === req.query.priority);
  }

  res.json({ complaints: complaints.map((item) => publicComplaint(item, db)) });
});

complaintsRouter.post("/", requireAuth, async (req, res) => {
  if (req.user.role !== "student") {
    return res.status(403).json({ message: "Only students can submit complaints." });
  }

  const db = await readDb();
  db.complaints ||= [];
  const student = db.students.find((item) => item.id === req.user.id);
  if (!student) return res.status(404).json({ message: "Student not found." });
  if (student.approvalStatus && student.approvalStatus !== "approved") {
    return res.status(403).json({ message: "Your student ID is not approved yet." });
  }

  try { validateKeys(req.body || {}, ["title", "category", "description", "location", "priority"]); } catch { return res.status(400).json({ message: "Invalid complaint data." }); }
  let title, category, description, location, priority;
  try {
    title = requiredText(req.body.title, "Title", { max: 160 });
    category = requiredText(req.body.category, "Category", { max: 80 });
    description = requiredText(req.body.description, "Description", { max: 3000 });
    location = req.body.location === undefined ? "" : requiredText(req.body.location, "Location", { min: 0, max: 160 });
    priority = req.body.priority === undefined ? "medium" : enumValue(req.body.priority, "Priority", ["low", "medium", "high"]);
  } catch { return res.status(400).json({ message: "Invalid complaint data." }); }

  const now = new Date().toISOString();
  const complaint = {
    id: makeId("cmp"),
    studentId: student.id,
    title, category, location, priority,
    status: "pending",
    description,
    response: "",
    createdAt: now,
    updatedAt: now
  };
  db.complaints.unshift(complaint);
  await writeDb(db);
  res.status(201).json({ success: true, message: "Complaint submitted.", complaint: publicComplaint(complaint, db) });
});

complaintsRouter.put("/:id", requireAuth, requireStaff, async (req, res) => {
  const db = await readDb();
  db.complaints ||= [];
  try { validateKeys(req.body || {}, ["status", "priority", "response", "category", "location"]); } catch { return res.status(400).json({ message: "Invalid complaint update." }); }
  const complaint = db.complaints.find((item) => item.id === req.params.id);
  if (!complaint) return res.status(404).json({ message: "Complaint not found." });

  if (req.body.status !== undefined && !["pending", "in-progress", "resolved"].includes(req.body.status)) {
    return res.status(400).json({ message: "Invalid complaint status." });
  }
  if (req.body.priority !== undefined && !["low", "medium", "high"].includes(req.body.priority)) {
    return res.status(400).json({ message: "Invalid complaint priority." });
  }
  for (const [field, max] of [["response", 3000], ["category", 80], ["location", 160]]) {
    if (req.body[field] !== undefined) { try { requiredText(req.body[field], field, { min: 0, max }); } catch { return res.status(400).json({ message: "Invalid complaint update." }); } }
  }

  ["status", "priority", "response", "category", "location"].forEach((field) => {
    if (req.body[field] !== undefined) complaint[field] = req.body[field];
  });
  complaint.updatedAt = new Date().toISOString();
  await writeDb(db);
  res.json({ success: true, message: "Complaint updated.", complaint: publicComplaint(complaint, db) });
});
