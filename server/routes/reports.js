import { Router } from "express";
import { readDb } from "../db/fileStore.js";
import { requireAdmin, requireAuth } from "../middleware/auth.js";
import { attendanceCsv, attendancePdf } from "../services/reportService.js";

export const reportsRouter = Router();

function filterRecords(records, query) {
  let output = records;
  if (query.studentId) output = output.filter((item) => item.studentId === query.studentId);
  if (query.subjectId) output = output.filter((item) => item.subjectId === query.subjectId);
  if (query.date) output = output.filter((item) => item.date === query.date);
  return output;
}

reportsRouter.get("/csv", requireAuth, requireAdmin, async (req, res) => {
  const db = await readDb();
  const csv = attendanceCsv(filterRecords(db.attendance, req.query), db);
  res.header("Content-Type", "text/csv");
  res.attachment("attendance-report.csv");
  res.send(csv);
});

reportsRouter.get("/pdf", requireAuth, requireAdmin, async (req, res) => {
  const db = await readDb();
  res.header("Content-Type", "application/pdf");
  res.attachment("attendance-report.pdf");
  attendancePdf(filterRecords(db.attendance, req.query), db, res);
});
