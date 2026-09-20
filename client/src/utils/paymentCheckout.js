// Browser side of the payment-provider boundary. Everything Razorpay-specific on
// the client (script URL, option names, callback field names) lives here; pages
// only see neutral names: { providerOrderId, currency } in, { orderId,
// paymentRef, signature } out. The script is loaded only when a student
// actually starts a payment, so nothing third-party loads on ordinary pages.
const CHECKOUT_SRC = "https://checkout.razorpay.com/v1/checkout.js";
let loading = null;

function loadCheckoutScript() {
  if (window.Razorpay) return Promise.resolve();
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = CHECKOUT_SRC;
      script.async = true;
      script.onload = resolve;
      script.onerror = () => { loading = null; script.remove(); reject(new Error("The payment window could not be loaded. Check your connection or ad blocker and try again.")); };
      document.head.appendChild(script);
    });
  }
  return loading;
}

// The amount is NOT passed: the order created by the server already carries it.
export async function openCheckout({ keyId, order, onPaid, onDismiss, onFailed }) {
  await loadCheckoutScript();
  if (!window.Razorpay) throw new Error("The payment window is unavailable.");
  const instance = new window.Razorpay({
    key: keyId,
    order_id: order.providerOrderId,
    currency: order.currency,
    name: "College fee payment",
    description: "Outstanding fees",
    theme: { color: "#2563eb" },
    handler: (response) => onPaid({ orderId: response.razorpay_order_id, paymentRef: response.razorpay_payment_id, signature: response.razorpay_signature }),
    modal: { ondismiss: onDismiss }
  });
  instance.on("payment.failed", (response) => onFailed(response?.error?.description || "The payment failed."));
  instance.open();
}
