// Renders a receipt PDF from a receiptView() object. Text is plain ASCII on
// purpose: pdfkit's built-in Helvetica has no rupee glyph, so amounts are
// printed as "INR 1,234.00".
import PDFDocument from "pdfkit";
import { formatMinor } from "./paymentLedger.js";

function line(doc, label, value) {
  doc.font("Helvetica").fillColor("#64748b").fontSize(10).text(label, { continued: true, width: 500 });
  doc.font("Helvetica-Bold").fillColor("#0f172a").text(`   ${String(value || "-")}`);
  doc.moveDown(0.35);
}

export function writeReceiptPdf(view, res) {
  const doc = new PDFDocument({ margin: 48, size: "A4", info: { Title: `Fee receipt ${view.receiptNumber}` } });
  doc.on("error", (error) => { console.error("Receipt PDF generation failed:", error); res.destroy(error); });
  res.on("close", () => { if (!res.writableEnded) doc.destroy(); });
  doc.pipe(res);

  doc.font("Helvetica-Bold").fontSize(20).fillColor("#0f172a").text("Fee Payment Receipt");
  doc.moveDown(0.2);
  doc.font("Helvetica").fontSize(10).fillColor("#64748b").text(`Receipt No. ${view.receiptNumber}`);
  doc.moveDown(1);

  line(doc, "Student", view.studentName);
  line(doc, "Roll number", view.rollNumber);
  line(doc, "Class", view.className);
  line(doc, "Department", view.department);
  if (view.academicYear) line(doc, "Academic year", view.academicYear);
  doc.moveDown(0.5);
  line(doc, "Amount paid", formatMinor(view.amountMinor, view.currency));
  if (Number.isFinite(view.balanceAfterMinor)) line(doc, "Balance after this payment", formatMinor(view.balanceAfterMinor, view.currency));
  line(doc, "Paid on", new Date(view.paidAt).toUTCString());
  line(doc, "Payment reference", view.reference);
  line(doc, "Receipt issued", new Date(view.issuedAt).toUTCString());

  if (view.mode !== "live") {
    doc.moveDown(1);
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#b91c1c").text("SANDBOX / TEST PAYMENT - no real money was charged. This is not a valid fee receipt.");
  }
  doc.end();
}
