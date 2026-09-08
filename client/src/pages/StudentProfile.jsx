import React, { useEffect, useState } from "react";
import { ArrowRight, Mail, Phone, QrCode, UserRound, X } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { apiFetch } from "../context/api.js";

export function StudentProfile() {
  const { user } = useAuth();
  const [requestedStatus, setRequestedStatus] = useState(user.approvalStatus || "approved");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [phone, setPhone] = useState(user.phone || "");
  const [guardian, setGuardian] = useState(user.guardian || "");
  const [saving, setSaving] = useState(false);
  const [attendanceSession, setAttendanceSession] = useState(null);
  const [attendanceLoading, setAttendanceLoading] = useState(true);
  useEffect(() => {
    apiFetch("/shared/student/portal").then((data) => setAttendanceSession(data.liveQuizSessions?.[0] || null)).catch(() => {}).finally(() => setAttendanceLoading(false));
  }, []);
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
      {!attendanceLoading && attendanceSession && <div className="attendance-modal-backdrop" role="presentation"><section className="attendance-modal panel" role="dialog" aria-modal="true" aria-labelledby="attendance-session-title"><button type="button" className="icon-button attendance-modal-close" aria-label="Close attendance prompt" onClick={() => setAttendanceSession(null)}><X size={18} /></button><span className="eyebrow">Live attendance session</span><h2 id="attendance-session-title">{attendanceSession.title}</h2><p>{attendanceSession.teacherName} has started a question session for <strong>{attendanceSession.className}</strong>.</p><div className="attendance-qr-frame"><img src={`https://api.qrserver.com/v1/create-qr-code/?size=260x260&margin=12&data=${encodeURIComponent(`${window.location.origin}/student/quiz-session/${attendanceSession.id}`)}`} alt="QR code for the live attendance session" /><span>Scan on another device, or continue below.</span></div><div className="success-box"><strong>Campus check required.</strong> Answer the session question and allow location access. Attendance is recorded only when you are within the college geofence.</div><Link className="primary-button full" to={`/student/quiz-session/${attendanceSession.id}`} onClick={() => setAttendanceSession(null)}><QrCode size={16} /> Open attendance session <ArrowRight size={16} /></Link></section></div>}
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
              <p className="helper-text">The administration makes the final approval decision. You can submit a review request from here.</p>
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
                  <textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Explain why your status should be reviewed" required />
                </label>
                <button className="primary-button" type="submit">Update approval status</button>
              </form>
              {message && <div role="status" className="success-box">{message}</div>}
              {error && <div role="alert" className="error-box">{error}</div>}
            </div>
            <p className="helper-text">You can also <Link to="/complaints">contact the administration through Complaints.</Link></p>
          </div>
        </article>
        <article className="panel">
          <h2>Contact & permitted edits</h2>
          <div className="contact-row"><Mail size={18} /> {user.email}</div>
          <form className="form-stack" onSubmit={async (event) => {
            event.preventDefault(); setSaving(true); setMessage(""); setError("");
            try { await apiFetch("/students/me/profile", { method: "PUT", body: JSON.stringify({ phone, guardian }) }); setMessage("Profile details updated."); }
            catch (err) { setError(err.message); } finally { setSaving(false); }
          }}>
            <label>Phone<input value={phone} onChange={(event) => setPhone(event.target.value)} maxLength={120} placeholder="Add a phone number" /></label>
            <label>Guardian<input value={guardian} onChange={(event) => setGuardian(event.target.value)} maxLength={120} placeholder="Guardian name" /></label>
            <button className="primary-button" type="submit" disabled={saving}>{saving ? "Saving..." : "Save contact details"}</button>
            {message && <div className="success-box">{message}</div>}
            {error && <div className="error-box">{error}</div>}
          </form>
        </article>
      </section>
      <section className="panel">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Student account</span>
            <h2>Student List</h2>
          </div>
          <Link className="secondary-button" to="/student-records">Open search and status filter</Link>
        </div>
        <p className="helper-text">Use the dedicated Student List page to search your record and filter its approval status.</p>
      </section>
    </div>
  );
}
