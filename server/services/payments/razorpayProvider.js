// Razorpay (sandbox) adapter. This is the ONLY file that knows Razorpay's URLs,
// header names, signature formats, and payload shapes; everything else talks to
// the neutral interface in ./index.js. It has no dependency on the database,
// Express, or any other feature code, and it never logs or returns a secret.
//
// Environment (read on every call so configuration changes take effect and
// tests can toggle them):
//   RAZORPAY_KEY_ID          public key id, "rzp_test_..." (sandbox)
//   RAZORPAY_KEY_SECRET      API secret - server only, never sent to clients
//   RAZORPAY_WEBHOOK_SECRET  secret configured on the Razorpay webhook
//   RAZORPAY_ALLOW_LIVE      "true" to accept "rzp_live_" keys (off by default)
//   RAZORPAY_API_BASE        non-production only; lets tests point at a fake API
import crypto from "node:crypto";

export const PROVIDER_ID = "razorpay";
const DEFAULT_API_BASE = "https://api.razorpay.com";
const ORDER_TIMEOUT_MS = 8000;

export class ProviderError extends Error {
  constructor(message, { status = null } = {}) { super(message); this.name = "ProviderError"; this.status = status; }
}

function env(name) { return String(process.env[name] || "").trim(); }

export function getConfig() {
  const keyId = env("RAZORPAY_KEY_ID");
  const keySecret = env("RAZORPAY_KEY_SECRET");
  const webhookSecret = env("RAZORPAY_WEBHOOK_SECRET");
  const missing = [];
  if (!keyId) missing.push("RAZORPAY_KEY_ID");
  if (!keySecret) missing.push("RAZORPAY_KEY_SECRET");
  if (!webhookSecret) missing.push("RAZORPAY_WEBHOOK_SECRET");

  let mode = null;
  let problem = null;
  if (keyId) {
    if (/^rzp_test_[A-Za-z0-9]+$/.test(keyId)) mode = "sandbox";
    else if (/^rzp_live_[A-Za-z0-9]+$/.test(keyId)) {
      if (env("RAZORPAY_ALLOW_LIVE") === "true") mode = "live";
      else problem = "Live keys are not accepted while payments run in sandbox mode.";
    } else problem = "RAZORPAY_KEY_ID is not a valid Razorpay key id.";
  }
  const configured = missing.length === 0 && !problem && Boolean(mode);
  return {
    provider: PROVIDER_ID,
    configured,
    // Webhook handling only needs the webhook secret; order creation needs the key pair.
    webhookConfigured: Boolean(webhookSecret),
    mode: configured ? mode : null,
    keyId: configured ? keyId : null, // public identifier, required by Checkout
    missing,
    problem,
    // Secrets stay module-private: callers get them only through the functions below.
    _keySecret: keySecret,
    _webhookSecret: webhookSecret
  };
}

function apiBase() {
  const override = env("RAZORPAY_API_BASE");
  if (override && process.env.NODE_ENV !== "production") {
    try { const url = new URL(override); if (["http:", "https:"].includes(url.protocol)) return url.origin; } catch { /* fall through */ }
  }
  return DEFAULT_API_BASE;
}

function hmacHex(secret, payload) {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

function safeEqualHex(expectedHex, givenValue) {
  if (typeof givenValue !== "string" || !/^[0-9a-fA-F]+$/.test(givenValue) || givenValue.length !== expectedHex.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expectedHex, "hex"), Buffer.from(givenValue.toLowerCase(), "hex"));
}

// Checkout callback signature: HMAC_SHA256(order_id + "|" + payment_id, key_secret)
export function verifyCheckoutSignature({ orderId, paymentRef, signature }) {
  const config = getConfig();
  if (!config.configured || typeof orderId !== "string" || typeof paymentRef !== "string" || !orderId || !paymentRef) return false;
  return safeEqualHex(hmacHex(config._keySecret, `${orderId}|${paymentRef}`), signature);
}

// Webhook signature: HMAC_SHA256(raw request body, webhook_secret) in X-Razorpay-Signature.
export function verifyWebhookSignature({ rawBody, headers }) {
  const config = getConfig();
  if (!config._webhookSecret || !Buffer.isBuffer(rawBody) || !rawBody.length) return false;
  return safeEqualHex(hmacHex(config._webhookSecret, rawBody), headers?.["x-razorpay-signature"]);
}

function cleanText(value, max) {
  return typeof value === "string" ? value.replace(/[\u0000-\u001F\u007F]/g, " ").trim().slice(0, max) : "";
}

// Turns a (signature-verified) webhook body into the neutral event shape, or
// null when the body is not a usable event.
export function parseWebhookEvent({ rawBody, headers }) {
  let body;
  try { body = JSON.parse(rawBody.toString("utf8")); } catch { return null; }
  if (!body || typeof body !== "object" || typeof body.event !== "string") return null;
  const paymentEntity = body.payload?.payment?.entity || null;
  const orderEntity = body.payload?.order?.entity || null;
  const headerId = cleanText(headers?.["x-razorpay-event-id"], 120);
  const eventId = headerId || `sha256:${crypto.createHash("sha256").update(rawBody).digest("hex")}`;
  const providerOrderId = cleanText(paymentEntity?.order_id || orderEntity?.id, 80);
  const event = {
    eventId,
    providerOrderId,
    providerPaymentId: cleanText(paymentEntity?.id, 80),
    amountMinor: Number.isSafeInteger(paymentEntity?.amount) ? paymentEntity.amount : null,
    currency: cleanText(paymentEntity?.currency, 8).toUpperCase(),
    failureReason: null,
    type: "ignored",
    rawType: cleanText(body.event, 60)
  };
  // Only a *captured* payment counts as money received. "authorized" is not enough.
  if ((body.event === "payment.captured" || body.event === "order.paid") && paymentEntity?.status === "captured") event.type = "payment.succeeded";
  else if (body.event === "payment.failed") {
    event.type = "payment.failed";
    event.failureReason = cleanText(paymentEntity?.error_description, 200) || "Payment failed.";
  }
  return event;
}

// Creates an order for a server-computed amount. Throws ProviderError with a
// safe, generic message on any failure (provider bodies are never surfaced).
export async function createOrder({ amountMinor, currency, receipt, notes }) {
  const config = getConfig();
  if (!config.configured) throw new ProviderError("Payments are not configured.");
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 100) throw new ProviderError("Invalid payment amount.");
  let response;
  try {
    response = await fetch(`${apiBase()}/v1/orders`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${config.keyId}:${config._keySecret}`).toString("base64")}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ amount: amountMinor, currency, receipt, notes: notes || {} }),
      signal: AbortSignal.timeout(ORDER_TIMEOUT_MS)
    });
  } catch {
    throw new ProviderError("The payment provider could not be reached.");
  }
  if (!response.ok) {
    console.error(`[payments] razorpay order creation failed with HTTP ${response.status}`);
    throw new ProviderError("The payment provider rejected the request.", { status: response.status });
  }
  let data;
  try { data = await response.json(); } catch { throw new ProviderError("The payment provider returned an unreadable response."); }
  // Never trust the provider blindly: the order must echo the amount we asked for.
  if (!data || typeof data.id !== "string" || !/^order_[A-Za-z0-9]+$/.test(data.id) || data.amount !== amountMinor || String(data.currency).toUpperCase() !== currency) {
    console.error("[payments] razorpay order response failed validation");
    throw new ProviderError("The payment provider returned an unexpected response.");
  }
  return { providerOrderId: data.id, amountMinor: data.amount, currency };
}

// Extra Content-Security-Policy sources Razorpay Checkout needs. Only used
// when the provider is configured, so an unconfigured deployment keeps the
// original strict policy.
export function cspSources() {
  return {
    script: ["https://checkout.razorpay.com"],
    connect: ["https://api.razorpay.com", "https://lumberjack.razorpay.com"],
    frame: ["https://api.razorpay.com", "https://checkout.razorpay.com"]
  };
}
