// PDF export for a subject's mark sheet. Mirrors reportService.js's
// attendancePdf: same pdfkit setup, same error/close handling so a pdfkit
// error or a client disconnecting mid-download can't hang the response or
// crash the process. Deliberately its own small module rather than sharing
// code with receiptPdf.js/reportService.js — those two lay out unrelated
// documents (a receipt, an attendance table), and there is no admit-card
// module in this codebase for this to depend on or be confused with.
import PDFDocument from "pdfkit";

export function marksSheetPdf(view, res) {
  const doc = new PDFDocument({ margin: 42, size: "A4" });
  doc.on("error", (error) => { console.error("Mark sheet PDF generation failed:", error); res.destroy(error); });
  res.on("close", () => { if (!res.writableEnded) doc.destroy(); });
  doc.pipe(res);

  doc.fontSize(18).text("Mark Sheet", { align: "left" });
  doc.moveDown(0.2);
  doc.fontSize(11).fillColor("#444")
    .text(`${view.subject.subjectName} (${view.subject.code}) · ${view.subject.className}`)
    .text(`Status: ${view.sheet.status} · Internal max: ${view.sheet.internalMax} · End-sem max: ${view.sheet.endSemMax}`);
  doc.moveDown(0.8);
  doc.fillColor("#000");

  const columns = [
    { label: "Roll No.", width: 70 },
    { label: "Student", width: 130 },
    { label: "Internal", width: 55 },
    { label: "End-sem", width: 55 },
    { label: "Total", width: 55 },
    { label: "%", width: 45 },
    { label: "Grade", width: 45 },
    { label: "Result", width: 65 }
  ];
  const startX = doc.page.margins.left;
  let y = doc.y;

  function drawRow(cells, { bold = false } = {}) {
    let x = startX;
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(9);
    columns.forEach((column, index) => {
      doc.text(String(cells[index] ?? ""), x, y, { width: column.width, ellipsis: true });
      x += column.width;
    });
    y += 18;
    if (y > doc.page.height - doc.page.margins.bottom - 30) {
      doc.addPage();
      y = doc.page.margins.top;
    }
  }

  drawRow(columns.map((column) => column.label), { bold: true });
  doc.moveTo(startX, y - 4).lineTo(startX + columns.reduce((sum, column) => sum + column.width, 0), y - 4).strokeColor("#ccc").stroke();

  if (view.students.length === 0) {
    doc.moveDown(1);
    doc.font("Helvetica").fontSize(10).text("No students on this roster yet.", startX, y);
  } else {
    for (const student of view.students) {
      const outcome = student.outcome;
      drawRow([
        student.rollNumber,
        student.name,
        student.absent ? "AB" : student.internal ?? "-",
        student.absent ? "AB" : student.endSem ?? "-",
        outcome ? outcome.totalMarks : "-",
        outcome ? `${outcome.percentage}%` : "-",
        outcome ? outcome.grade : "-",
        outcome ? (outcome.passed ? "Pass" : "Fail") : "-"
      ]);
    }
  }

  doc.end();
}
