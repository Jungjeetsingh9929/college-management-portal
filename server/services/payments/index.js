// Payment-service boundary. Routes and the ledger import ONLY this module, never
// a provider file directly, so switching provider means adding one adapter and
// changing the single `provider` binding below. Neutral vocabulary is used
// throughout (providerOrderId, paymentRef, amountMinor) - Razorpay's field names
// stay inside razorpayProvider.js.
import * as razorpay from "./razorpayProvider.js";

const provider = razorpay;

export { ProviderError } from "./razorpayProvider.js";
export const PAYMENT_PROVIDER = provider.PROVIDER_ID;
export const PAYMENT_CURRENCY = "INR";
export const MIN_PAYMENT_MINOR = 100;

// Safe-to-serialise view of the configuration. Contains no secrets - only the
// public key id (needed by the browser checkout) and, for staff diagnostics,
// the NAMES of missing variables.
export function getPaymentConfig() {
  const config = provider.getConfig();
  return {
    provider: config.provider,
    configured: config.configured,
    webhookConfigured: config.webhookConfigured,
    mode: config.mode,
    keyId: config.keyId,
    missing: config.missing,
    problem: config.problem
  };
}

export const createProviderOrder = provider.createOrder;
export const verifyCheckoutSignature = provider.verifyCheckoutSignature;
export const verifyWebhookSignature = provider.verifyWebhookSignature;
export const parseWebhookEvent = provider.parseWebhookEvent;

export function paymentCspSources() {
  return provider.getConfig().configured ? provider.cspSources() : { script: [], connect: [], frame: [] };
}
