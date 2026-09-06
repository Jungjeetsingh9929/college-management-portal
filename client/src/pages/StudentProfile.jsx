import React, { useState } from "react";
import { Mail, Phone, UserRound } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { apiFetch } from "../context/api.js";

export function StudentProfile() {
  const { user } = useAuth();
  const [requestedStatus, setRequestedStatus] = useState(user.approvalStatus || "approved");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const details = [
    ["Roll number", user.rollNumber],
    ["Class", user.className],
    ["Department", user.department],
    ["Graduation year", user.graduationYear || "-"],
    ["Approval status", user.approvalStatus || "approved"],
    ["Guardian", user.guardian || "-"]
  ];

  return (
    <div className="page-stack">
      <section className="profile-hero panel">
        <div className="avatar-lg">
          <UserRound size={42} />
        </div>
        <div>
          <span className="eyebrow">Student profile</span>
          <h2>{user.name}</h2>
          <p>{user.rollNumber} · {user.department}</p>
        </div>
      </section>
      <section className="profile-grid">
        <article className="panel">
          <h2>Academic details</h2>
          <div className="detail-list">
            {details.map(([label, value]) => (
              <div key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
            <div className="status-request-box">
              <h3>Update approval status</h3>
              <p className="helper-text">
                The administration makes the final approval decision. Submit a request for review below.
              </p>
              <form className="form-stack" onSubmit={async (event) => {
                event.preventDefault();
                setMessage("");
                setError("");
                try {
                  const data = await apiFetch("/students/me/status-request", {
                    method: "POST",
                    body: JSON.stringify({ requestedStatus, reason })
                  });
                  setMessage(data.message);
                  setReason("");
                } catch (err) {
                  setError(err.message);
                }
              }}>
                <label>
                  Requested status
                  <select value={requestedStatus} onChange={(event) => setRequestedStatus(event.target.value)}>
                    <option value="pending">Pending review</option>
                    <option value="approved">Approved</option>
                    <option value="rejected">Rejected</option>
                  </select>
                </label>
                <label>
                  Reason
                  <textarea
                    required
                    value={reason}
                    placeholder="Explain why your status should be reviewed"
                    onChange={(event) => setReason(event.target.value)}
                  />
                </label>
                <button className="primary-button" type="submit">
                  Update approval status
                </button>
              </form>
              {message && <div role="status" className="success-box">{message}</div>}
              {error && <div role="alert" className="error-box">{error}</div>}
            </div>
            <p className="helper-text">
              You can also <Link to="/complaints">contact the administration through Complaints.</Link>
            </p>
          </div>
        </article>
        <article className="panel">
          <h2>Contact</h2>
          <div className="contact-row"><Mail size={18} /> {user.email}</div>
          <div className="contact-row"><Phone size={18} /> {user.phone || "-"}</div>
        </article>
      </section>
      <StudentRecords />
    </div>
  );
}
