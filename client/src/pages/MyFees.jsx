import React, { useCallback, useEffect, useState } from "react";
import { CreditCard, Download, RefreshCw } from "lucide-react";
import { Badge, EmptyState, ErrorState, StatCard } from "../components/UI.jsx";
import { apiFetch, downloadToFile } from "../context/api.js";
import { openCheckout } from "../utils/paymentCheckout.js";

const inr = (value) => `₹${Number(value || 0).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const STATUS_LABEL = { created: "awaiting payment", paid: "paid", failed: "failed" };

export function MyFees() {
  const [config, setConfig] = useState(null);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null); // { type: "success" | "error" | "info", text }

  const load = useCallback(async () => {
    try {
      setError("");
      const [configResult, mine] = await Promise.all([apiFetch("/payments/config"), apiFetch("/payments/me")]);
      setConfig(configResult);
      setData(mine);
    } catch (err) { setError(err.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function pay() {
    setBusy(true);
    setNotice(null);
    try {
      // No amount is sent: the server prices the order from the fee record.
      const { order } = await apiFetch("/payments/orders", { method: "POST", body: JSON.stringify({}) });
      await openCheckout({
        keyId: order.keyId,
        order,
        onPaid: async (proof) => {
          try {
            const result = await apiFetch("/payments/verify", { method: "POST", body: JSON.stringify(proof) });
            setNotice(result.payment?.status === "paid" ? { type: "success", text: "Payment received. Your receipt is available below." } : { type: "info", text: "Your payment is being confirmed." });
          } catch {
            setNotice({ type: "info", text: "We could not confirm your payment yet. If money was deducted it will appear here once the bank confirms it - refresh in a minute." });
          } finally { await load(); setBusy(false); }
        },
        onDismiss: () => setBusy(false),
        onFailed: (message) => { setNotice({ type: "error", text: message }); setBusy(false); load(); }
      });
    } catch (err) {
      setNotice({ type: "error", text: err.message });
      setBusy(false);
    }
  }

  async function receipt(payment) {
    try { await downloadToFile(`/payments/${payment.id}/receipt`, `receipt-${payment.receiptNumber}.pdf`); }
    catch (err) { setNotice({ type: "error", text: err.message }); }
  }

  if (error && !data) return <ErrorState text={error} onRetry={load} />;
  if (!data) return <div className="skeleton-screen" />;
  const fee = data.fee;
  const configured = Boolean(config?.configured);

  return <div className="page-stack">
    <section className="welcome-banner"><div><span className="eyebrow">Fees & payments</span><h2>My fees</h2><p>Review your balance, pay online, and download receipts for completed payments.</p></div><div className="welcome-orb"><CreditCard size={34} /></div></section>
    {fee ? <section className="stats-grid">
      <StatCard label="Total fees" value={inr(fee.amountDue)} hint={fee.dueDate ? `Due ${fee.dueDate}` : "No due date"} tone="blue" />
      <StatCard label="Paid" value={inr(fee.amountPaid)} hint="Recorded payments" tone="green" />
      <StatCard label="Balance" value={inr(fee.balance)} hint={fee.status} tone={fee.balance > 0 ? "red" : "green"} />
    </section> : <section className="panel"><EmptyState title="No fee record yet" text="Your fee record will appear once your department publishes its fee structure." /></section>}

    {fee && fee.balance > 0 && <section className="panel">
      <div className="section-heading"><div><span className="eyebrow">Pay online</span><h2>Pay outstanding balance</h2></div>{configured && config.mode === "sandbox" && <Badge value="Test mode" />}</div>
      {configured ? <>
        <p className="helper-text">You will pay the full outstanding balance of <strong>{inr(fee.balance)}</strong>. The amount is set by the college, not by this page.</p>
        {config.mode === "sandbox" && <p className="helper-text">Test mode: no real money is charged.</p>}
        <button className="primary-button" type="button" onClick={pay} disabled={busy}><CreditCard size={17} /> {busy ? "Waiting for payment..." : `Pay ${inr(fee.balance)}`}</button>
      </> : <div className="info-box" role="status">Online payments are not available right now. Please pay at the fee desk; your balance stays up to date here.</div>}
      {notice && <div role={notice.type === "error" ? "alert" : "status"} className={notice.type === "error" ? "error-box" : notice.type === "success" ? "success-box" : "info-box"}>{notice.text}</div>}
    </section>}
    {(!fee || fee.balance <= 0) && notice && <div role={notice.type === "error" ? "alert" : "status"} className={notice.type === "error" ? "error-box" : notice.type === "success" ? "success-box" : "info-box"}>{notice.text}</div>}

    <section className="panel">
      <div className="section-heading"><div><span className="eyebrow">History</span><h2>Payment history</h2></div><button className="secondary-button" type="button" onClick={load}><RefreshCw size={15} /> Refresh</button></div>
      {data.payments.length ? <div className="table-wrap"><table><thead><tr><th>Date</th><th>Amount</th><th>Status</th><th>Receipt</th></tr></thead><tbody>
        {data.payments.map((payment) => <tr key={payment.id}>
          <td>{new Date(payment.paidAt || payment.createdAt).toLocaleString()}</td>
          <td><strong>{inr(payment.amount)}</strong></td>
          <td><Badge value={STATUS_LABEL[payment.status] || payment.status} />{payment.failureReason && <span className="helper-text"> {payment.failureReason}</span>}</td>
          <td>{payment.hasReceipt ? <button className="secondary-button" type="button" onClick={() => receipt(payment)}><Download size={15} /> {payment.receiptNumber}</button> : "—"}</td>
        </tr>)}
      </tbody></table></div> : <EmptyState title="No payments yet" text="Completed and attempted online payments will be listed here." />}
    </section>
  </div>;
}
