// HTTP-level tests for Phase 7 payments with the provider CONFIGURED. Razorpay is
// replaced by a local fake API (RAZORPAY_API_BASE is honoured outside
// production only); signatures are produced with the real HMAC scheme.
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-attendance-secret-32-chars-long";
process.env.SEED_ADMIN_EMAIL = "admin@example.edu";
process.env.SEED_ADMIN_PASSWORD = "Test-admin-password1!";
process.env.SEED_STUDENT_PASSWORD = "Test-student-password1!";
process.env.E2E_FACULTY_PASSWORD = "Test-e2e-faculty1!";
process.env.E2E_ADMIN_PASSWORD = "Test-e2e-admin1!";
process.env.DEMO_LOGIN_PASSWORD = "Test-demo-login1!";
process.env.FACULTY_LRG_PASSWORD = "Test-lrg-faculty1!";
process.env.COLLEGE_LATITUDE = "27.2124649";
process.env.COLLEGE_LONGITUDE = "75.7002425";
process.env.COLLEGE_RADIUS_METERS = "300";
process.env.PUBLIC_API_LIMIT = "5000";

const KEY_ID = "rzp_test_APITESTKEY1";
const KEY_SECRET = "api-test-key-secret-DO-NOT-LEAK";
const WEBHOOK_SECRET = "api-test-webhook-secret-DO-NOT-LEAK";
process.env.RAZORPAY_KEY_ID = KEY_ID;
process.env.RAZORPAY_KEY_SECRET = KEY_SECRET;
process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;

import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";

// ---- fake Razorpay ----
const providerOrders = [];
const fakeProvider = http.createServer((req, res) => {
  let data = "";
  req.on("data", (chunk) => { data += chunk; });
  req.on("end", () => {
    const body = JSON.parse(data || "{}");
    const expectedAuth = `Basic ${Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString("base64")}`;
    if (req.url !== "/v1/orders" || req.method !== "POST" || req.headers.authorization !== expectedAuth) { res.writeHead(401); return res.end("{}"); }
    providerOrders.push(body);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ id: `order_TEST${providerOrders.length}`, amount: body.amount, currency: body.currency, status: "created", receipt: body.receipt }));
  });
});
await new Promise((resolve) => fakeProvider.listen(0, "127.0.0.1", resolve));
process.env.RAZORPAY_API_BASE = `http://127.0.0.1:${fakeProvider.address().port}`;

const { resetDb } = await import("../server/db/fileStore.js");
const { default: app } = await import("../server/index.js");
await resetDb();
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}/api`;

const everyResponseBody = []; // scanned at the end: no secret may ever appear
async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, { ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) } });
  const raw = Buffer.from(await response.arrayBuffer());
  everyResponseBody.push(raw.toString("latin1"));
  const type = response.headers.get("content-type") || "";
  return { response, raw, data: type.includes("application/json") && raw.length ? JSON.parse(raw.toString("utf8")) : {} };
}
async function json(path, options = {}) {
  const { response, data } = await request(path, options);
  if (!response.ok) throw new Error(`${path}: ${data.message || `HTTP ${response.status}`}`);
  return data;
}
const auth = (session) => ({ Authorization: `Bearer ${session.token}` });
const login = (email, password, role) => json("/auth/login", { method: "POST", body: JSON.stringify({ email, password, role }) });
const hmac = (secret, data) => crypto.createHmac("sha256", secret).update(data).digest("hex");
let eventCounter = 0;
function capturedBody({ orderId, paymentId, amount, event = "payment.captured", status = "captured" }) {
  return JSON.stringify({ entity: "event", event, payload: { payment: { entity: { id: paymentId, order_id: orderId, amount, currency: "INR", status } } } });
}
function webhook(rawBody, { secret = WEBHOOK_SECRET, eventId = `evt_${++eventCounter}`, signature } = {}) {
  const headers = { "x-razorpay-event-id": eventId };
  if (signature !== null) headers["x-razorpay-signature"] = signature ?? hmac(secret, rawBody);
  return request("/payments/webhook", { method: "POST", headers, body: rawBody });
}

try {
  const admin = await login(process.env.SEED_ADMIN_EMAIL, process.env.SEED_ADMIN_PASSWORD, "admin");
  const student = await login("student001@example.edu", process.env.SEED_STUDENT_PASSWORD, "student");
  const otherStudent = await login("student002@example.edu", process.env.SEED_STUDENT_PASSWORD, "student");
  const teacher = await login("lrg@example.edu", process.env.FACULTY_LRG_PASSWORD, "teacher");

  // Give the student's department a fee so there is a balance to pay.
  const departments = await json("/admin/departments", { headers: auth(admin) });
  const department = departments.departments.find((item) => item.name === student.user.department);
  assert.ok(department, "student001's department exists");
  await json(`/admin/fees/structures/${department.id}`, { method: "PUT", headers: auth(admin), body: JSON.stringify({ tuitionFee: 25000, hostelFee: 0, examFee: 0, otherFee: 0, dueDate: "2027-01-07" }) });

  // ---- config: public key id only ----
  const config = await json("/payments/config", { headers: auth(student) });
  assert.deepEqual([config.configured, config.mode, config.keyId], [true, "sandbox", KEY_ID]);
  assert.ok(!("missing" in config), "students do not see diagnostics");
  assert.equal((await request("/payments/config")).response.status, 401);
  assert.equal((await json("/payments/config", { headers: auth(admin) })).webhookConfigured, true);

  // ---- access control ----
  assert.equal((await request("/payments/orders", { method: "POST", body: "{}" })).response.status, 401);
  assert.equal((await request("/payments/orders", { method: "POST", headers: auth(teacher), body: "{}" })).response.status, 403);
  assert.equal((await request("/payments/orders", { method: "POST", headers: auth(admin), body: "{}" })).response.status, 403);
  assert.equal((await request("/payments/me", { headers: auth(teacher) })).response.status, 403);
  assert.equal((await request("/admin/payments", { headers: auth(student) })).response.status, 403);

  // ---- order creation: amount comes from the server, client values are ignored ----
  const before = await json("/payments/me", { headers: auth(student) });
  assert.equal(before.fee.balance, 25000);
  assert.deepEqual(before.payments, []);
  const created = await request("/payments/orders", { method: "POST", headers: auth(student), body: JSON.stringify({ amount: 1, amountMinor: 1, feeId: "someone-elses-fee", studentId: otherStudent.user.id, currency: "USD" }) });
  assert.equal(created.response.status, 201);
  assert.equal(created.data.order.amountMinor, 2500000);
  assert.equal(created.data.order.currency, "INR");
  assert.equal(created.data.order.keyId, KEY_ID);
  assert.equal(providerOrders.length, 1);
  assert.equal(providerOrders[0].amount, 2500000, "provider order was created for the server-side amount");
  assert.equal(providerOrders[0].currency, "INR");
  const order = created.data.order;

  // a repeat request re-uses the open order instead of creating another
  const again = await request("/payments/orders", { method: "POST", headers: auth(student), body: "{}" });
  assert.equal(again.response.status, 200);
  assert.equal(again.data.order.providerOrderId, order.providerOrderId);
  assert.equal(providerOrders.length, 1);

  // ---- webhook: invalid signatures fail and change nothing ----
  const goodBody = capturedBody({ orderId: order.providerOrderId, paymentId: "pay_TEST1", amount: 2500000 });
  for (const badSignature of [hmac("wrong-secret", goodBody), hmac(WEBHOOK_SECRET, goodBody).slice(0, 40), "nothex", "", null]) {
    const res = await webhook(goodBody, { signature: badSignature });
    assert.equal(res.response.status, 400, `signature ${JSON.stringify(badSignature)} must be rejected`);
  }
  assert.equal((await webhook(goodBody, { signature: hmac(WEBHOOK_SECRET, goodBody + " ") })).response.status, 400, "signature over a different body");
  assert.equal((await request("/payments/webhook", { method: "POST", body: "" })).response.status, 400);
  const stillCreated = await json("/payments/me", { headers: auth(student) });
  assert.equal(stillCreated.payments[0].status, "created");
  assert.equal(stillCreated.fee.balance, 25000);

  // valid signature but malformed / non-event JSON
  assert.equal((await webhook("not json")).response.status, 400);
  assert.equal((await webhook("[]")).response.status, 400);

  // an "authorized" (not captured) payment is not a success
  const authorized = await webhook(capturedBody({ orderId: order.providerOrderId, paymentId: "pay_TEST1", amount: 2500000, event: "payment.authorized", status: "authorized" }));
  assert.equal(authorized.data.outcome, "ignored");
  assert.equal((await json("/payments/me", { headers: auth(student) })).payments[0].status, "created");

  // ---- webhook: an amount that differs from the stored order is not accepted ----
  const mismatch = await webhook(capturedBody({ orderId: order.providerOrderId, paymentId: "pay_TEST1", amount: 100 }));
  assert.equal(mismatch.response.status, 200);
  assert.equal(mismatch.data.outcome, "amount_mismatch");
  assert.equal((await json("/payments/me", { headers: auth(student) })).payments[0].status, "created");

  // ---- webhook: valid delivery settles once; repeats are idempotent ----
  const first = await webhook(goodBody, { eventId: "evt_settle" });
  assert.equal(first.response.status, 200);
  assert.equal(first.data.outcome, "settled");
  for (let i = 0; i < 5; i += 1) {
    const repeat = await webhook(goodBody, { eventId: "evt_settle" });
    assert.equal(repeat.response.status, 200);
    assert.equal(repeat.data.outcome, "duplicate_event");
  }
  const orderPaid = await webhook(capturedBody({ orderId: order.providerOrderId, paymentId: "pay_TEST1", amount: 2500000, event: "order.paid" }));
  assert.equal(orderPaid.data.outcome, "already_paid");
  const unknown = await webhook(capturedBody({ orderId: "order_DOESNOTEXIST", paymentId: "pay_X", amount: 2500000 }));
  assert.equal(unknown.response.status, 200);
  assert.equal(unknown.data.outcome, "unknown_order");

  const afterPaid = await json("/payments/me", { headers: auth(student) });
  assert.equal(afterPaid.payments.length, 1, "no duplicate payment records");
  const paid = afterPaid.payments[0];
  assert.equal(paid.status, "paid");
  assert.equal(paid.amountMinor, 2500000);
  assert.match(paid.receiptNumber, /^RCP-\d{4}-000001$/);
  assert.equal(afterPaid.fee.amountPaid, 25000, "fee credited exactly once");
  assert.equal(afterPaid.fee.balance, 0);
  assert.equal((await request("/payments/orders", { method: "POST", headers: auth(student), body: "{}" })).response.status, 409, "nothing left to pay");
  const adminFees = await json("/admin/fees", { headers: auth(admin) });
  const feeRow = adminFees.studentFees.find((item) => item.studentId === student.user.id);
  assert.deepEqual([feeRow.amountPaid, feeRow.balance, feeRow.status], [25000, 0, "paid"]);

  // ---- receipts: authorised downloads only ----
  const receipt = await request(`/payments/${paid.id}/receipt`, { headers: auth(student) });
  assert.equal(receipt.response.status, 200);
  assert.equal(receipt.response.headers.get("content-type"), "application/pdf");
  assert.match(receipt.response.headers.get("content-disposition") || "", /attachment; filename="receipt-RCP-\d{4}-000001\.pdf"/);
  assert.equal(receipt.raw.subarray(0, 5).toString("latin1"), "%PDF-");
  assert.equal((await request(`/payments/${paid.id}/receipt`, { headers: auth(admin) })).response.status, 200);
  assert.equal((await request(`/payments/${paid.id}/receipt`)).response.status, 401);
  assert.equal((await request(`/payments/${paid.id}/receipt`, { headers: auth(otherStudent) })).response.status, 404, "another student cannot fetch it");
  assert.equal((await request(`/payments/${paid.id}/receipt`, { headers: auth(teacher) })).response.status, 403);
  assert.equal((await request("/payments/does-not-exist/receipt", { headers: auth(student) })).response.status, 404);
  assert.equal((await request(`/payments/${encodeURIComponent("../x")}/receipt`, { headers: auth(student) })).response.status, 404);
  assert.equal((await json("/payments/me", { headers: auth(otherStudent) })).payments.length, 0, "history is per-student");

  // ---- second cycle: browser verify path (bad signature, then good) ----
  await json(`/admin/fees/students/${student.user.id}`, { method: "PATCH", headers: auth(admin), body: JSON.stringify({ amountDue: 26000 }) });
  const second = await json("/payments/orders", { method: "POST", headers: auth(student), body: "{}" });
  assert.equal(second.order.amountMinor, 100000);
  assert.equal(providerOrders.length, 2);
  const verify = (session, body) => request("/payments/verify", { method: "POST", headers: auth(session), body: JSON.stringify(body) });
  const goodVerify = { orderId: second.order.providerOrderId, paymentRef: "pay_TEST2", signature: hmac(KEY_SECRET, `${second.order.providerOrderId}|pay_TEST2`) };
  assert.equal((await verify(student, { ...goodVerify, signature: hmac("nope", `${goodVerify.orderId}|pay_TEST2`) })).response.status, 400);
  assert.equal((await verify(student, { ...goodVerify, paymentRef: "pay_TAMPERED" })).response.status, 400);
  assert.equal((await verify(student, { ...goodVerify, amount: 1 })).response.status, 400, "unexpected keys are rejected");
  assert.equal((await verify(otherStudent, goodVerify)).response.status, 404, "another student's order is not found");
  assert.equal((await verify(teacher, goodVerify)).response.status, 403);
  assert.equal((await json("/payments/me", { headers: auth(student) })).payments[0].status, "created");
  const verified = await verify(student, goodVerify);
  assert.equal(verified.response.status, 200);
  assert.equal(verified.data.payment.status, "paid");
  assert.equal((await verify(student, goodVerify)).data.payment.status, "paid", "verify is idempotent");
  const lateWebhook = await webhook(capturedBody({ orderId: second.order.providerOrderId, paymentId: "pay_TEST2", amount: 100000 }));
  assert.equal(lateWebhook.data.outcome, "already_paid");
  const finalMe = await json("/payments/me", { headers: auth(student) });
  assert.equal(finalMe.payments.length, 2);
  assert.equal(finalMe.fee.amountPaid, 26000);
  assert.deepEqual(finalMe.payments.map((item) => item.receiptNumber).sort(), [`RCP-${new Date().getUTCFullYear()}-000001`, `RCP-${new Date().getUTCFullYear()}-000002`]);

  // ---- failed payment is recorded and never treated as success ----
  await json(`/admin/fees/students/${student.user.id}`, { method: "PATCH", headers: auth(admin), body: JSON.stringify({ amountDue: 27000 }) });
  const third = await json("/payments/orders", { method: "POST", headers: auth(student), body: "{}" });
  const failed = await webhook(JSON.stringify({ event: "payment.failed", payload: { payment: { entity: { id: "pay_FAIL", order_id: third.order.providerOrderId, amount: 100000, currency: "INR", status: "failed", error_description: "Card declined" } } } }));
  assert.equal(failed.data.outcome, "failure_recorded");
  const failedMe = await json("/payments/me", { headers: auth(student) });
  assert.equal(failedMe.payments[0].status, "failed");
  assert.equal(failedMe.payments[0].hasReceipt, false);
  assert.equal(failedMe.fee.amountPaid, 26000);
  assert.equal((await request(`/payments/${failedMe.payments[0].id}/receipt`, { headers: auth(student) })).response.status, 404, "no receipt for an unpaid payment");

  // ---- admin history ----
  const history = await json("/admin/payments", { headers: auth(admin) });
  assert.equal(history.totals.paidCount, 2);
  assert.equal(history.totals.collectedMinor, 2600000);
  assert.equal(history.totals.failedCount, 1);
  assert.ok(history.payments.every((item) => item.studentName && !("providerOrderId" in item)));
  assert.equal((await json("/admin/payments?status=paid", { headers: auth(admin) })).payments.length, 2);

  // ---- audit trail of payment-state changes ----
  const security = await json("/admin/security?eventType=payment.", { headers: auth(admin) });
  const actions = security.auditLogs.map((item) => item.action);
  for (const expected of ["payment.order_created", "payment.paid", "payment.webhook_rejected", "payment.amount_mismatch", "payment.failed", "payment.verify_rejected"]) assert.ok(actions.includes(expected), `audit log has ${expected}`);
  assert.equal(actions.filter((action) => action === "payment.paid").length, 2, "one paid audit entry per payment");
  const feeAudit = (await json("/admin/security?eventType=fee.manual", { headers: auth(admin) })).auditLogs;
  assert.ok(feeAudit.length >= 2 && feeAudit[0].previousValue && feeAudit[0].newValue);

  // ---- secrets are never returned anywhere ----
  const everything = everyResponseBody.join("\n");
  assert.ok(!everything.includes(KEY_SECRET), "key secret leaked");
  assert.ok(!everything.includes(WEBHOOK_SECRET), "webhook secret leaked");
  assert.ok(!/password|passwordHistory/i.test(JSON.stringify((await json("/payments/me", { headers: auth(student) }))).replace(/"/g, "")), "no password material in payment responses");

  console.log("Payments API tests passed.");
} finally {
  server.close();
  fakeProvider.close();
}
