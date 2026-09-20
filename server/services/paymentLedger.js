// Payment state machine and receipt records. Pure functions over the database
// document: no I/O, no Express, no provider code, no imports from other
// feature modules, so the rules below can be unit-tested without a server.
//
// Callers MUST hold the write lock while running these and persist the
// document afterwards (routes do this via databaseWriteLock / withWriteLock).
// Audit entries are emitted through the injected `audit` callback so every
// state change is recorded in the same write as the change itself.
//
// Collections (created on demand, absent on older databases):
//   db.payments       one record per order: created -> paid, or created <-> failed -> paid
//   db.paymentEvents  provider event ids already processed (webhook idempotency)
//   db.paymentCounters.receipt  monotonically increasing receipt sequence

export const ORDER_REUSE_WINDOW_MS = 30 * 60 * 1000;
export const MAX_PAYMENT_EVENTS = 5000;

export function ensurePaymentCollections(db) {
  db.payments ||= [];
  db.paymentEvents ||= [];
  db.paymentCounters ||= { receipt: 0 };
  if (!Number.isInteger(db.paymentCounters.receipt)) db.paymentCounters.receipt = 0;
}

const round2 = (value) => Math.round(value * 100) / 100;

// Amount owed, in minor units (paise), derived ONLY from the stored fee record.
export function outstandingMinor(fee) {
  if (!fee) return 0;
  const minor = Math.round((Number(fee.amountDue) - Number(fee.amountPaid || 0)) * 100);
  return Number.isSafeInteger(minor) && minor > 0 ? minor : 0;
}

export function findReusableOrder(db, { feeId, amountMinor, now = Date.now() }) {
  ensurePaymentCollections(db);
  return db.payments.find((payment) =>
    payment.feeId === feeId && payment.amountMinor === amountMinor && (payment.status === "created" || payment.status === "failed")
    && now - new Date(payment.createdAt).getTime() < ORDER_REUSE_WINDOW_MS) || null;
}

export function recordOrder(db, { id, fee, student, providerOrderId, amountMinor, currency, provider, mode, actor, audit, now = new Date() }) {
  ensurePaymentCollections(db);
  const timestamp = now.toISOString();
  const payment = {
    id, studentId: student.id, feeId: fee.id, provider, mode: mode || null, providerOrderId, providerPaymentId: null,
    amountMinor, currency, status: "created", createdAt: timestamp, updatedAt: timestamp, paidAt: null,
    settledVia: null, failureReason: null, receiptNumber: null, receiptIssuedAt: null, balanceAfterMinor: null
  };
  db.payments.unshift(payment);
  audit?.({ userId: actor?.id ?? null, role: actor?.role ?? null, action: "payment.order_created", target: payment.id, previousValue: null, newValue: { status: "created", amountMinor, currency, providerOrderId } });
  return payment;
}

function nextReceiptNumber(db, date) {
  db.paymentCounters.receipt += 1;
  return `RCP-${date.getUTCFullYear()}-${String(db.paymentCounters.receipt).padStart(6, "0")}`;
}

// Moves a payment to "paid" exactly once: applies the STORED amount to the fee
// record, issues the single receipt number, and audits. Calling it again for an
// already-paid payment is a no-op.
export function settlePayment(db, payment, { providerPaymentId, source, actor, audit, now = new Date() }) {
  ensurePaymentCollections(db);
  if (payment.status === "paid") return { changed: false, outcome: "already_paid" };
  if (providerPaymentId && db.payments.some((other) => other !== payment && other.status === "paid" && other.providerPaymentId === providerPaymentId)) {
    audit?.({ userId: actor?.id ?? null, role: actor?.role ?? "system", action: "payment.duplicate_provider_payment", severity: "critical", success: false, target: payment.id, newValue: { source } });
    return { changed: false, outcome: "duplicate_provider_payment" };
  }
  const timestamp = now.toISOString();
  const previousStatus = payment.status;
  payment.status = "paid";
  payment.providerPaymentId = providerPaymentId || payment.providerPaymentId;
  payment.paidAt = timestamp;
  payment.updatedAt = timestamp;
  payment.settledVia = source;
  payment.failureReason = null;
  payment.receiptNumber = nextReceiptNumber(db, now);
  payment.receiptIssuedAt = timestamp;

  const fee = (db.studentFees || []).find((item) => item.id === payment.feeId);
  let overpaid = false;
  if (fee) {
    fee.amountPaid = round2(Number(fee.amountPaid || 0) + payment.amountMinor / 100);
    fee.updatedAt = timestamp;
    payment.balanceAfterMinor = Math.max(0, Math.round((Number(fee.amountDue) - fee.amountPaid) * 100));
    overpaid = fee.amountPaid > Number(fee.amountDue);
  }
  audit?.({
    userId: actor?.id ?? null, role: actor?.role ?? "system", action: "payment.paid", severity: fee && !overpaid ? "info" : "warning", target: payment.id,
    previousValue: { status: previousStatus },
    newValue: { status: "paid", amountMinor: payment.amountMinor, receiptNumber: payment.receiptNumber, via: source, feeRecordFound: Boolean(fee), overpaid, feeAmountPaid: fee ? fee.amountPaid : null }
  });
  return { changed: true, outcome: "settled" };
}

// Applies a normalised provider webhook event. Idempotent at two levels:
//  1. the provider event id is remembered, so a redelivery does nothing;
//  2. even a *different* event about an already-paid payment (payment.captured
//     followed by order.paid) is a no-op, because settlement is keyed on the
//     payment's status.
export function applyProviderEvent(db, event, { audit, now = new Date() } = {}) {
  ensurePaymentCollections(db);
  if (db.paymentEvents.some((entry) => entry.id === event.eventId)) return { changed: false, outcome: "duplicate_event", payment: null };

  const payment = db.payments.find((item) => item.providerOrderId === event.providerOrderId) || null;
  let outcome;
  if (!payment) {
    outcome = "unknown_order";
    audit?.({ action: "payment.webhook_unknown_order", severity: "warning", success: false, role: "system", target: event.providerOrderId || "", newValue: { type: event.type } });
  } else if (event.type === "payment.succeeded") {
    if (payment.status === "paid") outcome = "already_paid";
    else if (event.amountMinor !== payment.amountMinor || event.currency !== payment.currency) {
      outcome = "amount_mismatch";
      audit?.({ action: "payment.amount_mismatch", severity: "critical", success: false, role: "system", target: payment.id, newValue: { expectedMinor: payment.amountMinor, receivedMinor: event.amountMinor, expectedCurrency: payment.currency, receivedCurrency: event.currency } });
    } else outcome = settlePayment(db, payment, { providerPaymentId: event.providerPaymentId, source: "webhook", audit, now }).outcome;
  } else if (event.type === "payment.failed") {
    if (payment.status === "paid") outcome = "ignored_after_paid";
    else {
      const previousStatus = payment.status;
      payment.status = "failed";
      payment.failureReason = event.failureReason || "Payment failed.";
      payment.updatedAt = now.toISOString();
      outcome = "failure_recorded";
      audit?.({ action: "payment.failed", severity: "info", role: "system", target: payment.id, previousValue: { status: previousStatus }, newValue: { status: "failed", reason: payment.failureReason } });
    }
  } else outcome = "ignored";

  db.paymentEvents.unshift({ id: event.eventId, type: event.type, rawType: event.rawType || null, providerOrderId: event.providerOrderId || null, outcome, receivedAt: now.toISOString() });
  if (db.paymentEvents.length > MAX_PAYMENT_EVENTS) db.paymentEvents.length = MAX_PAYMENT_EVENTS;
  return { changed: true, outcome, payment };
}

// ---- Views (never include provider order ids of other users, secrets, or raw payloads) ----

export function publicPayment(payment) {
  return {
    id: payment.id,
    status: payment.status,
    amountMinor: payment.amountMinor,
    amount: payment.amountMinor / 100,
    currency: payment.currency,
    createdAt: payment.createdAt,
    paidAt: payment.paidAt,
    receiptNumber: payment.receiptNumber,
    hasReceipt: payment.status === "paid" && Boolean(payment.receiptNumber),
    reference: payment.status === "paid" ? payment.providerPaymentId : null,
    failureReason: payment.status === "failed" ? payment.failureReason : null,
    mode: payment.mode
  };
}

export function adminPayment(db, payment) {
  const student = (db.students || []).find((item) => item.id === payment.studentId);
  return { ...publicPayment(payment), studentId: payment.studentId, studentName: student?.name || "Unknown student", rollNumber: student?.rollNumber || "-", department: student?.department || "", settledVia: payment.settledVia };
}

// Everything printed on a receipt, taken from stored records only.
export function receiptView(db, payment) {
  if (!payment || payment.status !== "paid" || !payment.receiptNumber) return null;
  const student = (db.students || []).find((item) => item.id === payment.studentId) || {};
  const fee = (db.studentFees || []).find((item) => item.id === payment.feeId);
  const structure = fee ? (db.feeStructures || []).find((item) => item.departmentId === fee.departmentId) : null;
  return {
    receiptNumber: payment.receiptNumber,
    issuedAt: payment.receiptIssuedAt || payment.paidAt,
    paidAt: payment.paidAt,
    studentName: student.name || "Unknown student",
    rollNumber: student.rollNumber || "-",
    className: student.className || "",
    department: student.department || "",
    academicYear: structure?.academicYear || "",
    amountMinor: payment.amountMinor,
    currency: payment.currency,
    reference: payment.providerPaymentId || "",
    balanceAfterMinor: payment.balanceAfterMinor,
    mode: payment.mode || "sandbox"
  };
}

export function formatMinor(amountMinor, currency = "INR") {
  const whole = Math.trunc(amountMinor / 100);
  const fraction = String(Math.abs(amountMinor % 100)).padStart(2, "0");
  return `${currency} ${whole.toLocaleString("en-IN")}.${fraction}`;
}
