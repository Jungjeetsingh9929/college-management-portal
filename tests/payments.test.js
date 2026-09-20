// Dependency-free tests for the payment provider adapter and the ledger state
// machine (no Express, no database). The HTTP-level flow lives in
// tests/payments-api.test.js and the not-configured behaviour in api.test.js.
process.env.NODE_ENV = "test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";

const KEY_ID = "rzp_test_UNITKEY123";
const KEY_SECRET = "unit-key-secret-value";
const WEBHOOK_SECRET = "unit-webhook-secret-value";
const clearEnv = () => { for (const k of ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET", "RAZORPAY_ALLOW_LIVE", "RAZORPAY_API_BASE"]) delete process.env[k]; };
clearEnv();

const payments = await import("../server/services/payments/index.js");
const ledger = await import("../server/services/paymentLedger.js");
const sign = (secret, data) => crypto.createHmac("sha256", secret).update(data).digest("hex");

// ---- configuration: missing credentials => safe not-configured state ----
let config = payments.getPaymentConfig();
assert.equal(config.configured, false);
assert.equal(config.keyId, null);
assert.deepEqual(config.missing, ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET"]);
assert.equal(payments.verifyCheckoutSignature({ orderId: "order_1", paymentRef: "pay_1", signature: sign("", "order_1|pay_1") }), false);
assert.equal(payments.verifyWebhookSignature({ rawBody: Buffer.from("{}"), headers: { "x-razorpay-signature": sign("", "{}") } }), false);
await assert.rejects(() => payments.createProviderOrder({ amountMinor: 1000, currency: "INR", receipt: "r" }), /not configured/i);
assert.deepEqual(payments.paymentCspSources(), { script: [], connect: [], frame: [] });

process.env.RAZORPAY_KEY_ID = "rzp_live_LIVEKEY123";
process.env.RAZORPAY_KEY_SECRET = KEY_SECRET;
process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;
assert.equal(payments.getPaymentConfig().configured, false, "live keys are rejected in sandbox mode");
process.env.RAZORPAY_KEY_ID = "not-a-key";
assert.equal(payments.getPaymentConfig().configured, false);
process.env.RAZORPAY_KEY_ID = KEY_ID;
config = payments.getPaymentConfig();
assert.equal(config.configured, true);
assert.equal(config.mode, "sandbox");
assert.equal(config.keyId, KEY_ID);
assert.ok(!JSON.stringify(config).includes(KEY_SECRET) && !JSON.stringify(config).includes(WEBHOOK_SECRET), "config view must not contain secrets");
assert.ok(payments.paymentCspSources().script.length > 0);

// ---- signatures ----
const body = Buffer.from(JSON.stringify({ event: "payment.captured" }));
const goodSig = sign(WEBHOOK_SECRET, body);
assert.equal(payments.verifyWebhookSignature({ rawBody: body, headers: { "x-razorpay-signature": goodSig } }), true);
assert.equal(payments.verifyWebhookSignature({ rawBody: body, headers: { "x-razorpay-signature": goodSig.toUpperCase() } }), true, "hex is case-insensitive");
assert.equal(payments.verifyWebhookSignature({ rawBody: Buffer.from(`${body} `), headers: { "x-razorpay-signature": goodSig } }), false, "tampered body");
assert.equal(payments.verifyWebhookSignature({ rawBody: body, headers: { "x-razorpay-signature": sign("wrong", body) } }), false, "wrong secret");
assert.equal(payments.verifyWebhookSignature({ rawBody: body, headers: { "x-razorpay-signature": goodSig.slice(0, -2) } }), false, "short signature");
assert.equal(payments.verifyWebhookSignature({ rawBody: body, headers: { "x-razorpay-signature": "zz".repeat(32) } }), false, "non-hex signature");
assert.equal(payments.verifyWebhookSignature({ rawBody: body, headers: {} }), false, "missing signature");
assert.equal(payments.verifyWebhookSignature({ rawBody: body, headers: { "x-razorpay-signature": [goodSig] } }), false, "non-string signature");
assert.equal(payments.verifyWebhookSignature({ rawBody: "not a buffer", headers: { "x-razorpay-signature": goodSig } }), false);
assert.equal(payments.verifyWebhookSignature({ rawBody: Buffer.alloc(0), headers: { "x-razorpay-signature": goodSig } }), false);
const checkoutSig = sign(KEY_SECRET, "order_A1|pay_B2");
assert.equal(payments.verifyCheckoutSignature({ orderId: "order_A1", paymentRef: "pay_B2", signature: checkoutSig }), true);
assert.equal(payments.verifyCheckoutSignature({ orderId: "order_A1", paymentRef: "pay_OTHER", signature: checkoutSig }), false);
assert.equal(payments.verifyCheckoutSignature({ orderId: "order_OTHER", paymentRef: "pay_B2", signature: checkoutSig }), false);
assert.equal(payments.verifyCheckoutSignature({ orderId: "order_A1", paymentRef: "pay_B2", signature: sign(WEBHOOK_SECRET, "order_A1|pay_B2") }), false, "webhook secret must not validate checkout callbacks");

// ---- webhook parsing ----
const captured = (over = {}) => Buffer.from(JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: "pay_1", order_id: "order_1", amount: 250000, currency: "INR", status: "captured", ...over } } } }));
let ev = payments.parseWebhookEvent({ rawBody: captured(), headers: { "x-razorpay-event-id": "evt_1" } });
assert.deepEqual([ev.type, ev.eventId, ev.providerOrderId, ev.providerPaymentId, ev.amountMinor, ev.currency], ["payment.succeeded", "evt_1", "order_1", "pay_1", 250000, "INR"]);
assert.equal(payments.parseWebhookEvent({ rawBody: captured({ status: "authorized" }), headers: {} }).type, "ignored", "authorized is not paid");
assert.match(payments.parseWebhookEvent({ rawBody: captured(), headers: {} }).eventId, /^sha256:[0-9a-f]{64}$/);
ev = payments.parseWebhookEvent({ rawBody: Buffer.from(JSON.stringify({ event: "payment.failed", payload: { payment: { entity: { id: "pay_2", order_id: "order_1", amount: 1, currency: "INR", status: "failed", error_description: "Card declined\n" } } } })), headers: {} });
assert.deepEqual([ev.type, ev.failureReason], ["payment.failed", "Card declined"]);
assert.equal(payments.parseWebhookEvent({ rawBody: Buffer.from("not json"), headers: {} }), null);
assert.equal(payments.parseWebhookEvent({ rawBody: Buffer.from("[]"), headers: {} }), null);
assert.equal(payments.parseWebhookEvent({ rawBody: Buffer.from(JSON.stringify({ event: "refund.created" })), headers: {} }).type, "ignored");

// ---- provider order creation against a local fake Razorpay ----
const seen = [];
let mode = "ok";
const fake = http.createServer((req, res) => {
  let data = "";
  req.on("data", (chunk) => { data += chunk; });
  req.on("end", () => {
    const parsed = JSON.parse(data || "{}");
    seen.push({ url: req.url, auth: req.headers.authorization, body: parsed });
    if (mode === "500") { res.writeHead(500); return res.end(`{"error":"boom ${KEY_SECRET}"}`); }
    if (mode === "wrong-amount") { res.writeHead(200, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ id: "order_X1", amount: parsed.amount + 1, currency: "INR" })); }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ id: "order_UNIT1", amount: parsed.amount, currency: parsed.currency, status: "created" }));
  });
});
await new Promise((resolve) => fake.listen(0, "127.0.0.1", resolve));
process.env.RAZORPAY_API_BASE = `http://127.0.0.1:${fake.address().port}`;
try {
  const order = await payments.createProviderOrder({ amountMinor: 250000, currency: "INR", receipt: "rcpt-1", notes: { paymentId: "rcpt-1" } });
  assert.deepEqual(order, { providerOrderId: "order_UNIT1", amountMinor: 250000, currency: "INR" });
  assert.equal(seen[0].url, "/v1/orders");
  assert.equal(seen[0].auth, `Basic ${Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString("base64")}`);
  assert.equal(seen[0].body.amount, 250000);
  await assert.rejects(() => payments.createProviderOrder({ amountMinor: 99, currency: "INR", receipt: "r" }), /Invalid payment amount/);
  await assert.rejects(() => payments.createProviderOrder({ amountMinor: 10.5, currency: "INR", receipt: "r" }), /Invalid payment amount/);
  mode = "500";
  await assert.rejects(() => payments.createProviderOrder({ amountMinor: 1000, currency: "INR", receipt: "r" }), (error) => error.name === "ProviderError" && !error.message.includes(KEY_SECRET));
  mode = "wrong-amount";
  await assert.rejects(() => payments.createProviderOrder({ amountMinor: 1000, currency: "INR", receipt: "r" }), /unexpected response/);
} finally { fake.close(); }
process.env.RAZORPAY_API_BASE = "http://127.0.0.1:1"; // unreachable
await assert.rejects(() => payments.createProviderOrder({ amountMinor: 1000, currency: "INR", receipt: "r" }), (error) => error.name === "ProviderError");
clearEnv();

// ---- ledger ----
const newDb = () => ({
  students: [{ id: "stu1", name: "Asha", rollNumber: "R1", className: "C1", department: "CS" }],
  feeStructures: [{ departmentId: "d1", academicYear: "2026-27" }],
  studentFees: [{ id: "fee1", studentId: "stu1", departmentId: "d1", amountDue: 25000, amountPaid: 0, dueDate: "2027-01-01" }]
});
const collect = () => { const log = []; return { log, audit: (entry) => log.push(entry) }; };
const orderFor = (db, audit, providerOrderId = "order_1", amountMinor = 2500000) =>
  ledger.recordOrder(db, { id: "pay-uuid-1", fee: db.studentFees[0], student: db.students[0], providerOrderId, amountMinor, currency: "INR", provider: "razorpay", mode: "sandbox", actor: { id: "stu1", role: "student" }, audit });
const succeeded = (over = {}) => ({ eventId: "evt_1", type: "payment.succeeded", providerOrderId: "order_1", providerPaymentId: "pay_1", amountMinor: 2500000, currency: "INR", ...over });

assert.equal(ledger.outstandingMinor(newDb().studentFees[0]), 2500000);
assert.equal(ledger.outstandingMinor({ amountDue: 100, amountPaid: 100 }), 0);
assert.equal(ledger.outstandingMinor({ amountDue: 100, amountPaid: 150 }), 0);
assert.equal(ledger.outstandingMinor({ amountDue: 100.1, amountPaid: 0.05 }), 10005);
assert.equal(ledger.outstandingMinor(null), 0);

{
  const db = newDb(); const { log, audit } = collect();
  const payment = orderFor(db, audit);
  assert.equal(payment.status, "created");
  assert.equal(log.at(-1).action, "payment.order_created");
  // reuse of an open order for the same fee + amount
  assert.equal(ledger.findReusableOrder(db, { feeId: "fee1", amountMinor: 2500000 }).id, payment.id);
  assert.equal(ledger.findReusableOrder(db, { feeId: "fee1", amountMinor: 2400000 }), null);
  assert.equal(ledger.findReusableOrder(db, { feeId: "fee1", amountMinor: 2500000, now: Date.now() + 31 * 60 * 1000 }), null, "stale orders are not reused");

  // first delivery settles once; the fee is credited once; one receipt is issued
  let result = ledger.applyProviderEvent(db, succeeded(), { audit });
  assert.equal(result.outcome, "settled");
  assert.equal(payment.status, "paid");
  assert.equal(db.studentFees[0].amountPaid, 25000);
  assert.match(payment.receiptNumber, /^RCP-\d{4}-000001$/);
  assert.equal(payment.balanceAfterMinor, 0);
  // 20 redeliveries of the same event + different events for the same payment
  for (let i = 0; i < 20; i += 1) assert.equal(ledger.applyProviderEvent(db, succeeded(), { audit }).outcome, "duplicate_event");
  assert.equal(ledger.applyProviderEvent(db, succeeded({ eventId: "evt_2" }), { audit }).outcome, "already_paid");
  assert.equal(ledger.applyProviderEvent(db, succeeded({ eventId: "evt_3", providerPaymentId: "pay_other" }), { audit }).outcome, "already_paid");
  assert.equal(db.payments.length, 1);
  assert.equal(db.studentFees[0].amountPaid, 25000, "fee credited exactly once");
  assert.equal(db.paymentCounters.receipt, 1, "exactly one receipt number issued");
  assert.equal(log.filter((entry) => entry.action === "payment.paid").length, 1, "exactly one paid audit entry");
  assert.equal(db.paymentEvents.length, 3);
  // a late failure never un-pays
  assert.equal(ledger.applyProviderEvent(db, { eventId: "evt_4", type: "payment.failed", providerOrderId: "order_1", failureReason: "late" }, { audit }).outcome, "ignored_after_paid");
  assert.equal(payment.status, "paid");
  // settling directly again is also a no-op (verify-after-webhook)
  assert.equal(ledger.settlePayment(db, payment, { providerPaymentId: "pay_1", source: "client_verify", audit }).changed, false);
  assert.equal(db.paymentCounters.receipt, 1);
  assert.equal(db.studentFees[0].amountPaid, 25000);
}

{ // client-side amounts cannot matter: only the stored amount is ever applied
  const db = newDb(); const { audit } = collect();
  const payment = orderFor(db, audit);
  const result = ledger.applyProviderEvent(db, succeeded({ amountMinor: 100 }), { audit });
  assert.equal(result.outcome, "amount_mismatch");
  assert.equal(payment.status, "created");
  assert.equal(db.studentFees[0].amountPaid, 0);
  assert.equal(ledger.applyProviderEvent(db, succeeded({ eventId: "evt_9", currency: "USD" }), { audit }).outcome, "amount_mismatch");
  // the correct event still settles afterwards
  assert.equal(ledger.applyProviderEvent(db, succeeded({ eventId: "evt_10" }), { audit }).outcome, "settled");
  assert.equal(db.studentFees[0].amountPaid, 25000);
}

{ // failed -> paid is allowed (Razorpay lets a customer retry on the same order)
  const db = newDb(); const { log, audit } = collect();
  const payment = orderFor(db, audit);
  assert.equal(ledger.applyProviderEvent(db, { eventId: "f1", type: "payment.failed", providerOrderId: "order_1", failureReason: "Card declined" }, { audit }).outcome, "failure_recorded");
  assert.equal(payment.status, "failed");
  assert.equal(ledger.publicPayment(payment).failureReason, "Card declined");
  assert.equal(ledger.findReusableOrder(db, { feeId: "fee1", amountMinor: 2500000 }).id, payment.id);
  assert.equal(ledger.applyProviderEvent(db, succeeded({ eventId: "f2" }), { audit }).outcome, "settled");
  assert.equal(payment.failureReason, null);
  assert.deepEqual(log.map((entry) => entry.action), ["payment.order_created", "payment.failed", "payment.paid"]);
}

{ // unknown orders and ignored events change nothing but are remembered
  const db = newDb(); const { log, audit } = collect();
  orderFor(db, audit);
  assert.equal(ledger.applyProviderEvent(db, succeeded({ providerOrderId: "order_nope" }), { audit }).outcome, "unknown_order");
  assert.equal(ledger.applyProviderEvent(db, { eventId: "i1", type: "ignored", providerOrderId: "order_1" }, { audit }).outcome, "ignored");
  assert.equal(db.payments[0].status, "created");
  assert.equal(log.at(-1).action, "payment.webhook_unknown_order");
}

{ // receipts: sequential, unique, built from stored records only
  const db = newDb(); const { audit } = collect();
  orderFor(db, audit);
  ledger.settlePayment(db, db.payments[0], { providerPaymentId: "pay_A", source: "webhook", audit });
  db.studentFees[0].amountDue = 26000;
  const second = ledger.recordOrder(db, { id: "pay-uuid-2", fee: db.studentFees[0], student: db.students[0], providerOrderId: "order_2", amountMinor: 100000, currency: "INR", provider: "razorpay", mode: "sandbox", audit });
  assert.equal(ledger.settlePayment(db, second, { providerPaymentId: "pay_B", source: "client_verify", audit }).outcome, "settled");
  assert.deepEqual(db.payments.map((item) => item.receiptNumber).sort(), [`RCP-${new Date().getUTCFullYear()}-000001`, `RCP-${new Date().getUTCFullYear()}-000002`]);
  const view = ledger.receiptView(db, db.payments.find((item) => item.id === "pay-uuid-1"));
  assert.deepEqual([view.studentName, view.rollNumber, view.academicYear, view.amountMinor, view.reference], ["Asha", "R1", "2026-27", 2500000, "pay_A"]);
  assert.equal(ledger.receiptView(db, { ...db.payments[0], status: "created", receiptNumber: null }), null, "no receipt for unpaid payments");
  assert.equal(ledger.receiptView(db, null), null);
  assert.equal(ledger.formatMinor(2500050), "INR 25,000.50");
  // the same provider payment id cannot settle two different payments
  const third = ledger.recordOrder(db, { id: "pay-uuid-3", fee: db.studentFees[0], student: db.students[0], providerOrderId: "order_3", amountMinor: 100000, currency: "INR", provider: "razorpay", mode: "sandbox", audit });
  assert.equal(ledger.settlePayment(db, third, { providerPaymentId: "pay_A", source: "client_verify", audit }).outcome, "duplicate_provider_payment");
  assert.equal(third.status, "created");
}

{ // views never leak internals
  const db = newDb(); const { audit } = collect();
  const payment = orderFor(db, audit);
  const view = ledger.publicPayment(payment);
  for (const forbidden of ["providerOrderId", "studentId", "feeId", "providerPaymentId", "settledVia"]) assert.ok(!(forbidden in view), `${forbidden} must not be in the student view`);
  assert.equal(view.hasReceipt, false);
  assert.equal(ledger.adminPayment(db, payment).studentName, "Asha");
}

{ // event log is bounded
  const db = newDb(); const { audit } = collect();
  orderFor(db, audit);
  for (let i = 0; i < ledger.MAX_PAYMENT_EVENTS + 25; i += 1) ledger.applyProviderEvent(db, { eventId: `e${i}`, type: "ignored", providerOrderId: "order_1" }, { audit });
  assert.equal(db.paymentEvents.length, ledger.MAX_PAYMENT_EVENTS);
}

{ // older databases without any payment collections work
  const db = {};
  ledger.ensurePaymentCollections(db);
  assert.deepEqual([db.payments, db.paymentEvents, db.paymentCounters.receipt], [[], [], 0]);
}

console.log("Payment provider and ledger unit tests passed.");
