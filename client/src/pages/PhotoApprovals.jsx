import React, { useEffect, useState } from "react";
import { Camera, Check, Trash2, UserRound, X } from "lucide-react";
import { Badge, EmptyState, StatCard } from "../components/UI.jsx";
import { ProtectedImage } from "../components/ProtectedImage.jsx";
import { apiFetch } from "../context/api.js";

function formatWhen(iso) {
  return iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "";
}

export function PhotoApprovals() {
  const [items, setItems] = useState([]);
  const [stats, setStats] = useState({ pending: 0, approved: 0, rejected: 0 });
  const [status, setStatus] = useState("pending");
  const [loading, setLoading] = useState(true);
  const [rejectingId, setRejectingId] = useState("");
  const [reason, setReason] = useState("");
  const [busyId, setBusyId] = useState("");
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState("");

  async function load() {
    const data = await apiFetch(`/photos?status=${status}`);
    setItems(data.items);
    setStats(data.stats);
  }

  useEffect(() => {
    setLoading(true);
    load().catch(() => {}).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  async function act(id, action, successText) {
    setBusyId(id);
    setMessage("");
    try {
      if (action === "approve") await apiFetch(`/photos/${id}/approve`, { method: "POST", body: JSON.stringify({}) });
      else if (action === "reject") await apiFetch(`/photos/${id}/reject`, { method: "POST", body: JSON.stringify({ reason }) });
      else await apiFetch(`/photos/${id}`, { method: "DELETE" });
      setMessage(successText);
      setMessageType("success");
      setRejectingId("");
      setReason("");
      await load();
    } catch (error) {
      setMessage(error.message);
      setMessageType("error");
    } finally {
      setBusyId("");
    }
  }

  function removePhoto(id) {
    if (!window.confirm("Remove this photo? The student will have no photo until they upload a new one.")) return;
    act(id, "delete", "Photo removed.");
  }

  return (
    <div className="page-stack">
      <section className="stats-grid">
        <StatCard label="Awaiting review" value={stats.pending} hint="Oldest first" tone="amber" icon={Camera} />
        <StatCard label="Approved" value={stats.approved} hint="Live photos" tone="green" />
        <StatCard label="Rejected" value={stats.rejected} hint="Awaiting resubmission" tone="blue" />
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Student photos</span>
            <h2>Photo approvals</h2>
          </div>
          <Camera size={22} />
        </div>
        <div className="toolbar">
          <label>
            Show
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="pending">Pending review</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="all">All</option>
            </select>
          </label>
        </div>
        {message && (
          <div role="status" className={messageType === "error" ? "error-box" : "success-box"}>
            {message}
          </div>
        )}
        {loading ? (
          <p>Loading photos…</p>
        ) : items.length ? (
          <div className="library-list">
            {items.map((item) => (
              <article className="library-card photo-review-card" key={item.id}>
                <div className="photo-review-body">
                  <ProtectedImage photoId={item.hasImage ? item.id : null} alt={`Photo of ${item.student.name}`} className="photo-thumb" fallback={<div className="photo-thumb photo-empty"><UserRound size={28} /></div>} />
                  <div className="photo-review-info">
                    <strong>{item.student.name}</strong>
                    <span>
                      {item.student.rollNumber} · {item.student.className}
                      {item.student.department ? ` · ${item.student.department}` : ""}
                    </span>
                    <span>Submitted {formatWhen(item.submittedAt)}</span>
                    {item.status !== "pending" && (
                      <span>
                        {item.status === "approved" ? "Approved" : "Rejected"} {formatWhen(item.reviewedAt)}
                        {item.reviewedBy ? ` by ${item.reviewedBy}` : ""}
                      </span>
                    )}
                    {item.status === "rejected" && item.rejectionReason && <span>Reason: {item.rejectionReason}</span>}
                  </div>
                  <Badge value={item.status} />
                </div>
                {item.status === "pending" && rejectingId !== item.id && (
                  <div className="library-actions">
                    <button className="primary-button small" type="button" disabled={busyId === item.id} onClick={() => act(item.id, "approve", "Photo approved.")}>
                      <Check size={14} /> Approve
                    </button>
                    <button className="secondary-button small danger-text" type="button" disabled={busyId === item.id} onClick={() => { setRejectingId(item.id); setReason(""); }}>
                      <X size={14} /> Reject
                    </button>
                  </div>
                )}
                {item.status === "pending" && rejectingId === item.id && (
                  <div className="admin-form">
                    <label className="span-two">
                      Reason for rejection (shown to the student)
                      <input value={reason} onChange={(e) => setReason(e.target.value)} minLength={3} maxLength={300} placeholder="e.g. Face not clearly visible" autoFocus />
                    </label>
                    <button className="secondary-button danger-text" type="button" disabled={busyId === item.id || reason.trim().length < 3} onClick={() => act(item.id, "reject", "Photo rejected.")}>
                      Confirm rejection
                    </button>
                    <button className="secondary-button" type="button" onClick={() => setRejectingId("")}>
                      Cancel
                    </button>
                  </div>
                )}
                {item.status !== "pending" && (
                  <div className="library-actions">
                    <button className="secondary-button small danger-text" type="button" disabled={busyId === item.id} onClick={() => removePhoto(item.id)}>
                      <Trash2 size={14} /> Remove
                    </button>
                  </div>
                )}
              </article>
            ))}
          </div>
        ) : (
          <EmptyState title={status === "pending" ? "Nothing to review" : "No photos here"} text={status === "pending" ? "New student photo submissions will appear here." : "No photos match this filter."} />
        )}
      </section>
    </div>
  );
}
