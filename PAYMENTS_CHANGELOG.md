# Phase 7 — Payments (Razorpay sandbox)

Extends the fees module with online payment, history, and receipts. Independent
of feedback, projects, and admit cards (nothing from them is imported). Fee
records, balances, admin fee tools, and manual balance edits work exactly as
before **with no provider configured**.

## Provider choice and boundary

**Razorpay (sandbox), exactly one provider.** All provider-specific code is in
`server/services/payments/razorpayProvider.js` (URLs, header names, signature
formats, payload shapes). The rest of the app imports only the neutral
interface in `server/services/payments/index.js`
(`getPaymentConfig`, `createProviderOrder`, `verifyCheckoutSignature`,
`verifyWebhookSignature`, `parseWebhookEvent`). On the client the equivalent
boundary is `client/src/utils/paymentCheckout.js`. Razorpay's SDK is **not**
used (plain `fetch`), so `package.json` dependencies are unchanged.

## Configuration (environment only)

`RAZORPAY_KEY_ID` (`rzp_test_…`), `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`
— see `.env.example` / `render.yaml`. Payments are "configured" only when all
three are present and the key is a test key (`rzp_live_` is rejected unless
`RAZORPAY_ALLOW_LIVE=true`). Secrets are read from the environment on demand and
are never stored in the database, logged, or returned by any endpoint. The only
credential the API returns is the **public** key id, and only when configured.

Razorpay dashboard setup: webhook URL `https://<host>/api/payments/webhook`,
events `payment.captured`, `payment.failed`, `order.paid`, and **automatic
capture enabled** (an `authorized` but uncaptured payment is deliberately not
treated as paid).

## Not-configured behaviour

- `GET /api/payments/config` → `configured:false` (admins also see the *names* of missing variables).
- `POST /api/payments/orders`, `POST /api/payments/verify`, `POST /api/payments/webhook` → `503`, never a success.
- Student page shows "pay at the fee desk" instead of a Pay button; admin panel shows "not configured".
- CSP is not widened (Razorpay sources are added only when configured).

## API

| Route | Who | Notes |
|---|---|---|
| `GET /api/payments/config` | any signed-in user | no secrets |
| `GET /api/payments/me` | student | own fee summary + payment history |
| `POST /api/payments/orders` | student | **request body is ignored**; amount = server-side outstanding balance (fee due − paid), currency INR; re-uses an open order (≤ 30 min, same amount) so double-clicks don't create duplicates |
| `POST /api/payments/verify` | student | body `{orderId, paymentRef, signature}` only; verifies the checkout HMAC; own orders only (others → 404); shares the settlement code with the webhook |
| `POST /api/payments/webhook` | Razorpay | raw body + HMAC-SHA256 (timing-safe); invalid/missing signature → `400`; own rate limit |
| `GET /api/payments/:id/receipt` | owning student, admin | PDF; other student → `404`, teacher → `403`, anonymous → `401`; unpaid → `404` |
| `GET /api/admin/payments` | admin | history, `status`/`limit` filters, server-side totals |

## Payment state and idempotency (`server/services/paymentLedger.js`)

- States: `created` → `paid`; `created` ↔ `failed` → `paid` (Razorpay allows retries on an order). `paid` is final.
- Settlement happens **once per payment**: it credits the stored amount to the fee, issues one receipt number (`RCP-YYYY-NNNNNN`), and writes one audit entry. Client-supplied amounts never reach it.
- Webhook idempotency has two layers: the provider event id is remembered (`db.paymentEvents`, capped at 5000), and settlement is keyed on the payment's status, so a *different* event about an already-paid payment (`payment.captured` then `order.paid`) is also a no-op. Verify-after-webhook and webhook-after-verify are no-ops too.
- The webhook's amount and currency must equal the stored order or it is refused (`amount_mismatch`, critical audit).
- One provider payment id can never settle two payments.
- All ledger work runs under the existing write lock (`databaseWriteLock`, or `withWriteLock` for the webhook, which is mounted before `express.json()` because the signature needs the raw bytes).

## Audit

`payment.order_created`, `payment.paid`, `payment.failed`, `payment.amount_mismatch`,
`payment.webhook_rejected`, `payment.webhook_unknown_order`, `payment.verify_rejected`,
`payment.duplicate_provider_payment`, and `fee.manual_adjustment` (manual edits to a
fee's due/paid amounts via the existing admin PATCH, with before/after values).
Entries hold ids, statuses, and amounts only — never secrets or raw payloads.

## Receipts and history

Receipts are rendered on demand from stored records (`receiptView` → `receiptPdf.js`)
and only through the authorised route above. Amounts print as `INR 1,234.00`
(Helvetica has no ₹ glyph); sandbox receipts are watermarked as test payments.

## Client

- New student page **Fees & Payments** (`/my-fees`, `MyFees.jsx`): balance, Pay button or not-configured notice, history, receipt download. Success is shown only after the server confirms `paid`.
- Admin **Payment history** panel (`AdminPaymentsPanel.jsx`) appended to Fees & Notices.

## Tests

- `tests/payments.test.js` (dependency-free): signatures, webhook parsing, provider adapter against a local fake Razorpay, config states, ledger idempotency (20 redeliveries), amount mismatch, failed→paid, receipts, bounded event log.
- `tests/payments-api.test.js`: full HTTP flow with the provider configured against a fake Razorpay (invalid signatures, repeat webhooks, ignored client amounts, verify path, receipt authorisation, audit trail, no secret in any response).
- `tests/api.test.js`: not-configured block; the suite now clears `RAZORPAY_*` so real credentials can't leak in.
- Both new files are in `npm test`.

## Files not changed

`server/middleware/auth.js`, `server/db/fileStore.js`, `server/db/database.json`, photo routes/services.

## Known limits / decisions

- Full outstanding balance only (no part-payments or refunds; refund events are ignored).
- `POST /payments/orders` calls Razorpay while holding the global write lock (8 s timeout) because the lock is taken by middleware before the handler.
- Payment records are financial records and are kept when a student account is deleted (the existing delete route is unchanged).
- The CSP additions for Razorpay Checkout need one real browser check against the sandbox.
