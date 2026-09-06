import { Router } from "express";
import { makeId, readDb, writeDb } from "../db/fileStore.js";
import { requireAuth, requireStaff } from "../middleware/auth.js";

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

  if (!req.body.title || !req.body.category || !req.body.description) {
    return res.status(400).json({ message: "Title, category, and description are required." });
  }

  const now = new Date().toISOString();
  const complaint = {
    id: makeId("cmp"),
    studentId: student.id,
    title: req.body.title,
    category: req.body.category,
    location: req.body.location || "",
    priority: req.body.priority || "medium",
    status: "pending",
    description: req.body.description,
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
  const complaint = db.complaints.find((item) => item.id === req.params.id);
  if (!complaint) return res.status(404).json({ message: "Complaint not found." });

  ["status", "priority", "response", "category", "location"].forEach((field) => {
    if (req.body[field] !== undefined) complaint[field] = req.body[field];
  });
  complaint.updatedAt = new Date().toISOString();
  await writeDb(db);
  res.json({ success: true, message: "Complaint updated.", complaint: publicComplaint(complaint, db) });
});
