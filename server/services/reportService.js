import PDFDocument from "pdfkit";
import { enrichAttendance } from "./attendanceService.js";
import { toCsv } from "./csv.js";

export function attendanceCsv(records, db) {
  const rows = enrichAttendance(records, db);
  const header = ["Date", "Time", "Student", "Roll Number", "Class", "Subject", "Code", "Status", "Method"];
  const body = rows.map((row) => [
    row.date,
    row.time,
    row.studentName,
    row.rollNumber,
    row.className,
    row.subjectName,
    row.subjectCode,
    row.status,
    row.method
  ]);

  return toCsv(header, body);
}

export function attendancePdf(records, db, res) {
  const rows = enrichAttendance(records, db);
  const doc = new PDFDocument({ margin: 42, size: "A4" });
  // Without these, a pdfkit error (or the client disconnecting mid-download)
  // left the response hanging open until the socket timed out, and the error
  // surfaced as an unhandled 'error' event that takes the process down.
  doc.on("error", (error) => { console.error("PDF generation failed:", error); res.destroy(error); });
  res.on("close", () => { if (!res.writableEnded) doc.destroy(); });
  doc.pipe(res);

  doc.fontSize(20).text("College Attendance Report", { align: "left" });
  doc.moveDown(0.3);
  doc.fontSize(10).fillColor("#64748b").text(`Generated records: ${rows.length}`);
  doc.moveDown();

  doc.fillColor("#111827").fontSize(10);
  rows.forEach((row, index) => {
    doc
      .font("Helvetica-Bold")
      .text(`${index + 1}. ${row.studentName} (${row.rollNumber})`, { continued: true })
      .font("Helvetica")
      .text(`  ${row.status.toUpperCase()}`);
    doc
      .fillColor("#475569")
      .text(`${row.date} ${row.time} | ${row.subjectName} (${row.subjectCode}) | ${row.method}`);
    doc.fillColor("#111827").moveDown(0.35);
  });

  doc.end();
}
