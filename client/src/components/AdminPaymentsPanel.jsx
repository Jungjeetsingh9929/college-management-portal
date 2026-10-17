import React, { useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Badge, EmptyState } from "./UI.jsx";
import { apiFetch, downloadToFile } from "../context/api.js";

const inr = (minor) => `₹${(Number(minor || 0) / 100).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

// Admin-only: payment provider status, totals, and recent payments with receipts.
export function AdminPaymentsPanel() {
  const [config, setConfig] = useState(null);
  const [history, setHistory] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([apiFetch("/payments/config"), apiFetch("/admin/payments?limit=25")])
      .then(([configResult, historyResult]) => { setConfig(configResult); setHistory(historyResult); })
      .catch((err) => setError(err.message));
  }, []);

  // Built from history.totals, which the panel already fetches for the
  // summary line below - no new data source, per the Phase 8 dashboard rule.
  const chartData = useMemo(() => {
    if (!history) return [];
    const { paidCount = 0, pendingCount = 0, failedCount = 0 } = history.totals;
    return [
      { label: "Paid", count: paidCount },
      { label: "Pending", count: pendingCount },
      { label: "Failed", count: failedCount }
    ];
  }, [history]);
  const hasChartData = chartData.some((item) => item.count > 0);

  if (error) return <section className="panel"><div className="error-box" role="alert">{error}</div></section>;
  if (!config || !history) return null;
  return <section className="panel">
    <div className="section-heading"><div><span className="eyebrow">Online payments</span><h2>Payment history</h2></div><Badge value={config.configured ? `${config.mode} connected` : "not configured"} /></div>
    {!config.configured && <p className="helper-text">Online payments are off, so students see the fee desk message. Fee records and manual balance edits work as usual.{config.missing?.length ? ` Missing settings: ${config.missing.join(", ")}.` : ""}{config.problem ? ` ${config.problem}` : ""}</p>}
    <p className="helper-text">{history.totals.paidCount} paid · {inr(history.totals.collectedMinor)} collected · {history.totals.pendingCount} awaiting payment · {history.totals.failedCount} failed</p>
    {hasChartData ? (
      <div className="chart-box"><ResponsiveContainer width="100%" height={180}><BarChart data={chartData}><XAxis dataKey="label" /><YAxis allowDecimals={false} /><Tooltip /><Bar dataKey="count" fill="#6869ed" radius={[6, 6, 0, 0]} /></BarChart></ResponsiveContainer></div>
    ) : (
      <EmptyState title="No payment activity yet" text="A breakdown of paid, pending, and failed payments will appear here." />
    )}
    {history.payments.length ? <div className="table-wrap"><table><thead><tr><th>Date</th><th>Student</th><th>Amount</th><th>Status</th><th>Receipt</th></tr></thead><tbody>
      {history.payments.map((payment) => <tr key={payment.id}>
        <td>{new Date(payment.paidAt || payment.createdAt).toLocaleString()}</td>
        <td><strong>{payment.studentName}</strong><span>{payment.rollNumber} · {payment.department}</span></td>
        <td>{inr(payment.amountMinor)}</td>
        <td><Badge value={payment.status} /></td>
        <td>{payment.hasReceipt ? <button className="secondary-button" type="button" onClick={() => downloadToFile(`/payments/${payment.id}/receipt`, `receipt-${payment.receiptNumber}.pdf`).catch(() => {})}><Download size={15} /> {payment.receiptNumber}</button> : "—"}</td>
      </tr>)}
    </tbody></table></div> : <EmptyState title="No payments yet" text="Online payments will be listed here once students start paying." />}
  </section>;
}
