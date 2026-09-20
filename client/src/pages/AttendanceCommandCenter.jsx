import React, { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { Activity, AlertTriangle, Clock3, Copy, Download, ExternalLink, Mail, MessageCircle, QrCode, RefreshCw, ShieldAlert, Users } from "lucide-react";
import { apiDownload, apiFetch } from "../context/api.js";
import { Badge, EmptyState, SearchableSelect, StatCard } from "../components/UI.jsx";

function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
function sessionState(session) {
  const now = Date.now();
  if (!session.active || now > new Date(session.endsAt).getTime()) return "closed";
  if (now < new Date(session.startsAt).getTime()) return "scheduled";
  return "live";
}

// The URL that actually goes into the QR image and the share links.
//
// The server sends `qrPath` (origin-less, e.g. "/attend/session_1?t=...").
// Resolving it here against window.location.origin means the link always
// points at the same deployment the teacher is looking at right now. That
// removes the one failure this flow couldn't detect on its own: a
// misconfigured CLIENT_ORIGIN baking an unreachable host into a QR code
// that still scans perfectly well, and only dies on the student's phone.
// `session.qr` (absolute, server-built) stays as the fallback for any
// response that predates qrPath.
export function sessionCheckInUrl(session) {
  if (session?.qrPath && typeof window !== "undefined") {
    try { return new URL(session.qrPath, window.location.origin).toString(); }
    catch { /* fall through to the server-built URL */ }
  }
  return session?.qr || "";
}

// One session card. Only a live session gets a scannable QR + share links -
// a scheduled/closed session's token isn't meant to be handed out.
function SessionCard({ session, subject, onRotate, onRemind, reminding, reminderNote, qrImage }) {
  const state = sessionState(session);
  const subjectLabel = subject ? `${subject.subjectName} (${subject.className})` : "this class";
  const checkInUrl = sessionCheckInUrl(session);
  const whatsappText = `Scan or tap to check in to ${subjectLabel} attendance: ${checkInUrl}`;
  return (
    <article className={`session-card ${state}`}>
      <div className="session-card-top">
        <div className="session-title">
          <span className={`session-dot ${state}`} />
          <div><strong>{subject?.subjectName || "Subject"}</strong><span>{subject?.className || "Class not available"}</span></div>
        </div>
        <Badge value={state} />
      </div>
      <div className="session-meta"><span><Clock3 size={13} /> {formatDate(session.startsAt)}</span></div>
      {state === "live" && checkInUrl && (
        <div className="session-qr-row">
          {qrImage ? <img src={qrImage} alt="Scan to check in to this attendance session" className="session-qr-thumb" width={88} height={88} /> : <span className="muted">Generating QR…</span>}
          <div className="session-qr-actions">
            <a className="ghost-button small" href={checkInUrl} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Open link</a>
            <button type="button" className="ghost-button small" onClick={() => navigator.clipboard?.writeText(checkInUrl)}><Copy size={13} /> Copy link</button>
            <a className="whatsapp-button small" href={`https://wa.me/?text=${encodeURIComponent(whatsappText)}`} target="_blank" rel="noreferrer"><MessageCircle size={13} /> Share to WhatsApp</a>
            {/* Emails the check-in link to students in this class who have
                not been marked yet. The in-app bell notification only
                reaches students who already have the portal open. */}
            <button type="button" className="ghost-button small" onClick={onRemind} disabled={reminding}><Mail size={13} /> {reminding ? "Sending…" : "Email reminder"}</button>
          </div>
        </div>
      )}
      {reminderNote && <small className="muted session-reminder-note">{reminderNote}</small>}
      <div className="session-actions">
        <small>Ends {formatDate(session.endsAt)}</small>
        <button className="ghost-button small" onClick={onRotate} disabled={state === "closed"}><RefreshCw size={14} /> Rotate QR</button>
      </div>
    </article>
  );
}

export function AttendanceCommandCenter() {
  const [data, setData] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [corrections, setCorrections] = useState([]);
  const [error, setError] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [subjects, setSubjects] = useState([]);
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [qrImages, setQrImages] = useState({});
  const [remindingId, setRemindingId] = useState("");
  const [reminderNotes, setReminderNotes] = useState({});
  const [reviewActionId, setReviewActionId] = useState("");
  const [correctionActionId, setCorrectionActionId] = useState("");

  async function load() {
    try {
      setError("");
      const [dashboard, sessionData, subjectData, correctionData] = await Promise.all([
        apiFetch("/attendance/dashboard"),
        apiFetch("/attendance/sessions"),
        apiFetch("/subjects"),
        apiFetch("/attendance/corrections")
      ]);
      setData(dashboard);
      setSessions(sessionData.sessions || []);
      setSubjects(subjectData.subjects || []);
      setCorrections((correctionData.corrections || []).filter((item) => item.status === "pending"));
      if (!subjectId && subjectData.subjects?.length) setSubjectId(subjectData.subjects[0].id);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  // Renders a real, scannable PNG for every currently-live session's
  // check-in URL, client-side (no backend change needed - the server just
  // returns the real URL in `session.qr`, see server/routes/attendance.js).
  // Keyed by qrToken so a rotation regenerates the image automatically.
  useEffect(() => {
    let cancelled = false;
    async function generate() {
      const live = sessions.filter((session) => sessionState(session) === "live" && sessionCheckInUrl(session));
      const next = {};
      for (const session of live) {
        try { next[`${session.id}:${session.qrToken}`] = await QRCode.toDataURL(sessionCheckInUrl(session), { width: 176, margin: 1 }); }
        catch { /* QR just won't render for this one - the link/copy/WhatsApp options still work */ }
      }
      if (!cancelled) setQrImages(next);
    }
    generate();
    return () => { cancelled = true; };
  }, [sessions]);

  async function createSession() {
    if (!subjectId) return;
    setCreating(true);
    try {
      await apiFetch("/attendance/sessions", { method: "POST", body: JSON.stringify({ subjectId, durationMinutes: 30, lateAfterMinutes: 10 }) });
      await load();
    } catch (err) { setError(err.message); } finally { setCreating(false); }
  }
  async function rotate(id) {
    try { await apiFetch(`/attendance/sessions/${id}/rotate`, { method: "POST" }); await load(); } catch (err) { setError(err.message); }
  }
  // The server decides who still needs reminding and whether SMTP was
  // available, so its message is shown verbatim on the card rather than
  // guessed at here.
  async function remind(id) {
    setRemindingId(id);
    try {
      const result = await apiFetch(`/attendance/sessions/${id}/remind`, { method: "POST" });
      setReminderNotes((current) => ({ ...current, [id]: result.message }));
    } catch (err) {
      setReminderNotes((current) => ({ ...current, [id]: err.message }));
    } finally { setRemindingId(""); }
  }
  async function actOnReviewItem(id, status) {
    setReviewActionId(id);
    try { await apiFetch(`/attendance/review-queue/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }); await load(); }
    catch (err) { setError(err.message); }
    finally { setReviewActionId(""); }
  }
  async function actOnCorrection(id, status) {
    setCorrectionActionId(id);
    try { await apiFetch(`/attendance/corrections/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }); await load(); }
    catch (err) { setError(err.message); }
    finally { setCorrectionActionId(""); }
  }
  async function download() {
    const blob = await apiDownload("/attendance/export.csv");
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "attendance-report.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const liveSessions = useMemo(() => sessions.filter((session) => sessionState(session) === "live"), [sessions]);
  return (
    <div className="page-stack attendance-center">
      <section className="attendance-hero">
        <div>
          <span className="eyebrow">Operations / attendance intelligence</span>
          <h2>Attendance command center</h2>
          <p>One operational view for verified sessions, exceptions, interventions, and the attendance record.</p>
        </div>
        <div className="hero-actions">
          <span className="live-indicator"><i /> {liveSessions.length ? `${liveSessions.length} live session${liveSessions.length > 1 ? "s" : ""}` : "No live sessions"}</span>
          <button className="secondary-button" onClick={load} disabled={loading}><RefreshCw size={15} className={loading ? "spin" : ""} /> Refresh</button>
        </div>
      </section>

      {error && <div className="warning-banner"><AlertTriangle size={18} /> <span>{error}</span></div>}
      {loading && !data && <section className="panel loading-panel">Loading attendance intelligence…</section>}
      {data && <>
        <div className="stats-grid attendance-stats">
          <StatCard label="Recorded events" value={data.totals.records} hint="All scoped attendance" icon={Activity} />
          <StatCard label="Sessions created" value={data.totals.sessions} hint={`${liveSessions.length} currently live`} tone="green" icon={QrCode} />
          <StatCard label="Open review items" value={data.totals.exceptions} hint="Risk and exception events" tone="amber" icon={ShieldAlert} />
          <StatCard label="Intervention alerts" value={data.lowAttendance.length} hint="Below 75% attendance" tone="red" icon={Users} />
        </div>

        <div className="two-column attendance-main-grid">
          <section className="panel session-panel">
            <div className="section-heading"><div><span className="eyebrow">Verified presence</span><h2>Session control</h2></div><span className="section-icon blue"><QrCode size={18} /></span></div>
            <p className="panel-lede">Create a time-bound QR session. Students are validated by rotating token, campus geofence, device risk, and replay protection.</p>
            <div className="session-create-row">
              <label className="grow">
                Subject
                <SearchableSelect
                  options={subjects}
                  value={subjectId}
                  onChange={setSubjectId}
                  getValue={(subject) => subject.id}
                  getLabel={(subject) => subject.subjectName}
                  getSecondaryLabel={(subject) => subject.className}
                  placeholder="Search subject or class…"
                  emptyText="No subjects match your search"
                  disabled={!subjects.length}
                />
              </label>
              <button className="primary-button session-start" disabled={creating || !subjectId} onClick={createSession}><QrCode size={16} /> {creating ? "Starting…" : "Start session"}</button>
            </div>
            {sessions.length > 0 ? <div className="session-list">{sessions.slice(0, 6).map((session) => (
              <SessionCard
                key={session.id}
                session={session}
                subject={subjects.find((subject) => subject.id === session.subjectId)}
                onRotate={() => rotate(session.id)}
                onRemind={() => remind(session.id)}
                reminding={remindingId === session.id}
                reminderNote={reminderNotes[session.id]}
                qrImage={qrImages[`${session.id}:${session.qrToken}`]}
              />
            ))}</div> : <EmptyState title="No sessions yet" text="Start a session to enable verified QR attendance." />}
          </section>

          <section className="panel action-panel"><div className="section-heading"><div><span className="eyebrow">Intervention desk</span><h2>Action center</h2></div><button className="secondary-button small" onClick={download}><Download size={14} /> Export</button></div><div className="privacy-note"><ShieldAlert size={16} /><span>Location and device data are retained only as risk-scoped verification metadata.</span></div>{data.lowAttendance.length ? <div className="alert-list">{data.lowAttendance.slice(0, 7).map((student) => <div className="alert-row" key={student.id}><div className="alert-avatar">{student.name.slice(0, 1)}</div><div className="alert-copy"><strong>{student.name}</strong><span>{student.className} · {student.stats.present}/{student.stats.total} qualifying sessions</span></div><strong className="alert-percent">{student.stats.percentage}%</strong></div>)}</div> : <EmptyState title="No intervention alerts" text="Students are currently above the configured threshold." />}</section>
        </div>

        <div className="two-column analytics-grid"><section className="panel"><div className="section-heading"><div><span className="eyebrow">Coverage map</span><h2>Attendance by class</h2></div></div><div className="analytics-list">{(data.analytics.byClass || []).slice(0, 8).map((item) => <div className="analytics-row" key={item.key}><div><strong>{item.key}</strong><span>{item.present + item.late} qualifying · {item.absent} absent</span></div><div className="analytics-value"><strong>{item.percentage}%</strong><div className="mini-progress"><i style={{ width: `${item.percentage}%` }} /></div></div></div>)}</div></section><section className="panel"><div className="section-heading"><div><span className="eyebrow">Risk review</span><h2>Exception queue</h2></div><span className="queue-count">{data.reviewQueue.length} open</span></div>{data.reviewQueue.length ? <div className="alert-list">{data.reviewQueue.slice(0, 6).map((item) => <div className="review-row" key={item.id}><div className="review-icon"><ShieldAlert size={15} /></div><div><strong>{item.reason}</strong><span>{formatDate(item.createdAt)} · {item.attendanceId}</span></div><Badge value={item.severity} /><div className="review-row-actions"><button className="ghost-button small" disabled={reviewActionId === item.id} onClick={() => actOnReviewItem(item.id, "resolved")}>Resolve</button><button className="ghost-button small" disabled={reviewActionId === item.id} onClick={() => actOnReviewItem(item.id, "dismissed")}>Dismiss</button></div></div>)}</div> : <EmptyState title="Queue is clear" text="No open device-risk or exception events require review." />}</section></div>

        <div className="two-column analytics-grid">
          <section className="panel">
            <div className="section-heading"><div><span className="eyebrow">Requested by students</span><h2>Corrections</h2></div><span className="queue-count">{corrections.length} pending</span></div>
            {corrections.length ? (
              <div className="alert-list">
                {corrections.slice(0, 6).map((item) => (
                  <div className="review-row" key={item.id}>
                    <div className="review-icon"><ShieldAlert size={15} /></div>
                    <div>
                      <strong>{item.studentName} · {item.subjectName}</strong>
                      <span>{item.date} · currently {item.currentStatus} → requested {item.requestedStatus}</span>
                      <span>{item.reason}</span>
                    </div>
                    <div className="review-row-actions">
                      <button className="ghost-button small" disabled={correctionActionId === item.id} onClick={() => actOnCorrection(item.id, "approved")}>Approve</button>
                      <button className="ghost-button small" disabled={correctionActionId === item.id} onClick={() => actOnCorrection(item.id, "rejected")}>Reject</button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title="No pending corrections" text="Students haven't requested any attendance corrections." />
            )}
          </section>
        </div>
      </>}
    </div>
  );
}
