import { Router } from "express";
import crypto from "node:crypto";
import { readDb, withWriteLock, writeDb } from "../db/fileStore.js";
import { requireAdmin, requireAuth } from "../middleware/auth.js";
import { appendAudit } from "../services/auditService.js";
import { validId, validateKeys } from "../services/validation.js";
import { ensureCollections, publicStudentFee } from "./fees.js";
import {
  PAYMENT_CURRENCY, MIN_PAYMENT_MINOR, PAYMENT_PROVIDER,
  ProviderError, createProviderOrder, getPaymentConfig, parseWebhookEvent, verifyCheckoutSignature, verifyWebhookSignature
} from "../services/payments/index.js";
import {
  adminPayment, applyProviderEvent, ensurePaymentCollections, findReusableOrder, outstandingMinor, publicPayment, receiptView, recordOrder, settlePayment
} from "../services/paymentLedger.js";
import { writeReceiptPdf } from "../services/receiptPdf.js";

// Payments extend the fees module; nothing here changes how fee records work,
// and every route degrades to a clear "not configured" answer when no provider
// credentials are present (fee records, balances, and admin fee tools are
// unaffected).
export const paymentsRouter = Router();

const NOT_CONFIGURED = { message: "Online payments are not configured. Please pay at the fee desk.", code: "payments_not_configured" };

function requireStudent(req, res, next) {
  if (req.user?.role !== "student") return res.status(403).json({ message: "Only students can make fee payments." });
  next();
}

// Public view of the configuration. Never contains a secret; the key id is the
// public identifier the browser checkout needs. Staff additionally see which
// variables are missing (names only).
paymentsRouter.get("/payments/config", requireAuth, (req, res) => {
  const config = getPaymentConfig();
  const body = { provider: config.provider, configured: config.configured, mode: config.mode, keyId: config.keyId, currency: PAYMENT_CURRENCY };
  if (req.user.role === "admin") { body.missing = config.missing; body.problem = config.problem; body.webhookConfigured = config.webhookConfigured; }
  res.json(body);
});

// Student's own fee summary and payment history.
paymentsRouter.get("/payments/me", requireAuth, requireStudent, async (req, res) => {
  const db = await readDb();
  ensureCollections(db);
  ensurePaymentCollections(db);
  const fee = db.studentFees.find((item) => item.studentId === req.user.id);
  const summary = fee ? publicStudentFee(fee, db) : null;
  res.json({
    configured: getPaymentConfig().configured,
    fee: summary && { amountDue: summary.amountDue, amountPaid: summary.amountPaid || 0, balance: summary.balance, dueDate: summary.dueDate || "", status: summary.status },
    payments: db.payments.filter((item) => item.studentId === req.user.id).slice(0, 100).map(publicPayment)
  });
});

// Creates (or re-uses) a provider order for the student's OUTSTANDING balance.
// The request body is deliberately ignored: the amount, currency, and fee
// record all come from the server, so a client cannot choose what it pays.
paymentsRouter.post("/payments/orders", requireAuth, requireStudent, async (req, res) => {
  const config = getPaymentConfig();
  if (!config.configured) return res.status(503).json(NOT_CONFIGURED);
  const db = await readDb();
  ensureCollections(db);
  ensurePaymentCollections(db);
  const student = db.students.find((item) => item.id === req.user.id);
  const fee = db.studentFees.find((item) => item.studentId === req.user.id);
  if (!student || !fee) return res.status(404).json({ message: "No fee record was found for your account." });
  const amountMinor = outstandingMinor(fee);
  if (amountMinor <= 0) return res.status(409).json({ message: "You have no outstanding fees." });
  if (amountMinor < MIN_PAYMENT_MINOR) return res.status(409).json({ message: "The outstanding balance is below the minimum online payment amount. Please pay at the fee desk." });

  // A double-click, or a retry after closing the checkout, re-uses the open order.
  const existing = findReusableOrder(db, { feeId: fee.id, amountMinor });
  const order = (payment) => ({ paymentId: payment.id, providerOrderId: payment.providerOrderId, amountMinor: payment.amountMinor, amount: payment.amountMinor / 100, currency: payment.currency, keyId: config.keyId, mode: config.mode });
  if (existing) return res.json({ order: order(existing), reused: true });

  const paymentId = crypto.randomUUID();
  let providerOrder;
  try {
    providerOrder = await createProviderOrder({ amountMinor, currency: PAYMENT_CURRENCY, receipt: paymentId, notes: { paymentId } });
  } catch (error) {
    if (!(error instanceof ProviderError)) throw error;
    return res.status(502).json({ message: "The payment provider is unavailable right now. Please try again shortly." });
  }
  const payment = recordOrder(db, {
    id: paymentId, fee, student, providerOrderId: providerOrder.providerOrderId, amountMinor, currency: PAYMENT_CURRENCY,
    provider: PAYMENT_PROVIDER, mode: config.mode, actor: req.user, audit: (event) => appendAudit(db, { ...event, ip: req.ip, userAgent: req.get("user-agent") })
  });
  await writeDb(db);
  res.status(201).json({ order: order(payment), reused: false });
});

// Fast path after the browser checkout completes. The webhook is the
// authoritative signal; this verifies the provider's signed callback so the
// student sees the result immediately (and it works where no webhook is
// reachable, e.g. local development). Both paths share settlePayment(), so
// whichever arrives second is a no-op.
paymentsRouter.post("/payments/verify", requireAuth, requireStudent, async (req, res) => {
  if (!getPaymentConfig().configured) return res.status(503).json(NOT_CONFIGURED);
  try { validateKeys(req.body || {}, ["orderId", "paymentRef", "signature"]); } catch { return res.status(400).json({ message: "Invalid verification request." }); }
  const { orderId, paymentRef, signature } = req.body || {};
  for (const value of [orderId, paymentRef, signature]) {
    if (typeof value !== "string" || !value || value.length > 200) return res.status(400).json({ message: "Invalid verification request." });
  }
  const db = await readDb();
  ensurePaymentCollections(db);
  const audit = (event) => appendAudit(db, { ...event, ip: req.ip, userAgent: req.get("user-agent") });
  // Ownership is part of the lookup: another student's order id is simply "not found".
  const payment = db.payments.find((item) => item.providerOrderId === orderId && item.studentId === req.user.id);
  if (!payment) return res.status(404).json({ message: "Payment not found." });
  if (!verifyCheckoutSignature({ orderId, paymentRef, signature })) {
    audit({ userId: req.user.id, role: req.user.role, action: "payment.verify_rejected", severity: "warning", success: false, target: payment.id, newValue: { reason: "invalid_signature" } });
    await writeDb(db);
    return res.status(400).json({ message: "Payment verification failed." });
  }
  settlePayment(db, payment, { providerPaymentId: paymentRef, source: "client_verify", actor: req.user, audit });
  await writeDb(db);
  res.json({ payment: publicPayment(payment) });
});

// Authorised receipt download: the owning student or an admin. Anyone else
// (including other students) gets 404 so payment ids cannot be probed.
paymentsRouter.get("/payments/:id/receipt", requireAuth, async (req, res) => {
  if (!["student", "admin"].includes(req.user.role)) return res.status(403).json({ message: "You do not have access to payment receipts." });
  if (!validId(req.params.id)) return res.status(404).json({ message: "Receipt not found." });
  const db = await readDb();
  ensurePaymentCollections(db);
  const payment = db.payments.find((item) => item.id === req.params.id);
  const allowed = payment && (req.user.role === "admin" || payment.studentId === req.user.id);
  const view = allowed ? receiptView(db, payment) : null;
  if (!view) return res.status(404).json({ message: "Receipt not found." });
  res.set({ "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="receipt-${view.receiptNumber}.pdf"`, "Cache-Control": "no-store" });
  writeReceiptPdf(view, res);
});

// Admin payment history with simple filters. Totals are computed server-side.
paymentsRouter.get("/admin/payments", requireAuth, requireAdmin, async (req, res) => {
  const db = await readDb();
  ensurePaymentCollections(db);
  const status = String(req.query.status || "");
  const limit = Math.max(1, Math.min(200, Number.parseInt(req.query.limit || "50", 10) || 50));
  const all = db.payments;
  const filtered = ["created", "paid", "failed"].includes(status) ? all.filter((item) => item.status === status) : all;
  res.json({
    configured: getPaymentConfig().configured,
    payments: filtered.slice(0, limit).map((item) => adminPayment(db, item)),
    totals: {
      paidCount: all.filter((item) => item.status === "paid").length,
      collectedMinor: all.filter((item) => item.status === "paid").reduce((sum, item) => sum + item.amountMinor, 0),
      pendingCount: all.filter((item) => item.status === "created").length,
      failedCount: all.filter((item) => item.status === "failed").length
    }
  });
});

// Provider webhook. Mounted in server/index.js BEFORE express.json() with a raw
// body parser, because the signature is computed over the exact bytes sent.
// It runs outside databaseWriteLock, so every read-modify-write below goes
// through withWriteLock(). Unsigned/invalid requests never touch payment state.
export async function paymentWebhookHandler(req, res) {
  res.set("Cache-Control", "no-store");
  const config = getPaymentConfig();
  if (!config.webhookConfigured) return res.status(503).json({ message: "Payments are not configured." });
  const rawBody = Buffer.isBuffer(req.body) ? req.body : null;
  if (!rawBody || !rawBody.length) return res.status(400).json({ message: "Empty webhook body." });

  if (!verifyWebhookSignature({ rawBody, headers: req.headers })) {
    try {
      await withWriteLock(async () => {
        const db = await readDb();
        appendAudit(db, { role: "system", action: "payment.webhook_rejected", severity: "warning", success: false, ip: req.ip, userAgent: req.get("user-agent"), target: "payments/webhook", newValue: { reason: "invalid_signature" } });
        await writeDb(db);
      });
    } catch (error) { console.error("[payments] could not audit rejected webhook:", error.message); }
    return res.status(400).json({ message: "Invalid webhook signature." });
  }

  const event = parseWebhookEvent({ rawBody, headers: req.headers });
  if (!event) return res.status(400).json({ message: "Malformed webhook payload." });

  const result = await withWriteLock(async () => {
    const db = await readDb();
    const outcome = applyProviderEvent(db, event, { audit: (entry) => appendAudit(db, { ...entry, ip: req.ip, userAgent: req.get("user-agent") }) });
    if (outcome.changed) await writeDb(db);
    return outcome;
  });
  res.status(200).json({ ok: true, outcome: result.outcome });
}
