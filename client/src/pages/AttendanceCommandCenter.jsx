import React, { useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, CheckCircle2, Clock3, Download, QrCode, RefreshCw, ShieldAlert, Users } from "lucide-react";
import { apiDownload, apiFetch } from "../context/api.js";
import { Badge, EmptyState, StatCard } from "../components/UI.jsx";

function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
function sessionState(session) {
  const now = Date.now();
  if (!session.active || now > new Date(session.endsAt).getTime()) return "closed";
  if (now < new Date(session.startsAt).getTime()) return "scheduled";
  return "live";
}

export function AttendanceCommandCenter() {
  const [data, setData] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [error, setError] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [subjects, setSubjects] = useState([]);
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);

  async function load() {
    try {
      setError("");
      const [dashboard, sessionData, subjectData] = await Promise.all([
        apiFetch("/attendance/dashboard"),
        apiFetch("/attendance/sessions"),
        apiFetch("/subjects")
      ]);
      setData(dashboard);
      setSessions(sessionData.sessions || []);
      setSubjects(subjectData.subjects || []);
      if (!subjectId && subjectData.subjects?.length) setSubjectId(subjectData.subjects[0].id);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

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
            <div className="session-create-row"><label className="grow">Subject<select value={subjectId} onChange={(event) => setSubjectId(event.target.value)}>{subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.subjectName} · {subject.className}</option>)}</select></label><button className="primary-button session-start" disabled={creating || !subjectId} onClick={createSession}><QrCode size={16} /> {creating ? "Starting…" : "Start session"}</button></div>
            {sessions.length > 0 ? <div className="session-list">{sessions.slice(0, 6).map((session) => { const state = sessionState(session); return <article className={`session-card ${state}`} key={session.id}><div className="session-card-top"><div className="session-title"><span className={`session-dot ${state}`} /><div><strong>{subjects.find((subject) => subject.id === session.subjectId)?.subjectName || "Subject"}</strong><span>{subjects.find((subject) => subject.id === session.subjectId)?.className || "Class not available"}</span></div></div><Badge value={state} /></div><div className="session-meta"><span><Clock3 size={13} /> {formatDate(session.startsAt)}</span><span className="token-preview">Token · {session.qrToken}</span></div><div className="session-actions"><small>Ends {formatDate(session.endsAt)}</small><button className="ghost-button small" onClick={() => rotate(session.id)} disabled={state === "closed"}><RefreshCw size={14} /> Rotate QR</button></div></article>; })}</div> : <EmptyState title="No sessions yet" text="Start a session to enable verified QR attendance." />}
          </section>

          <section className="panel action-panel"><div className="section-heading"><div><span className="eyebrow">Intervention desk</span><h2>Action center</h2></div><button className="secondary-button small" onClick={download}><Download size={14} /> Export</button></div><div className="privacy-note"><ShieldAlert size={16} /><span>Location and device data are retained only as risk-scoped verification metadata.</span></div>{data.lowAttendance.length ? <div className="alert-list">{data.lowAttendance.slice(0, 7).map((student) => <div className="alert-row" key={student.id}><div className="alert-avatar">{student.name.slice(0, 1)}</div><div className="alert-copy"><strong>{student.name}</strong><span>{student.className} · {student.stats.present}/{student.stats.total} qualifying sessions</span></div><strong className="alert-percent">{student.stats.percentage}%</strong></div>)}</div> : <EmptyState title="No intervention alerts" text="Students are currently above the configured threshold." />}</section>
        </div>

        <div className="two-column analytics-grid"><section className="panel"><div className="section-heading"><div><span className="eyebrow">Coverage map</span><h2>Attendance by class</h2></div></div><div className="analytics-list">{(data.analytics.byClass || []).slice(0, 8).map((item) => <div className="analytics-row" key={item.key}><div><strong>{item.key}</strong><span>{item.present + item.late} qualifying · {item.absent} absent</span></div><div className="analytics-value"><strong>{item.percentage}%</strong><div className="mini-progress"><i style={{ width: `${item.percentage}%` }} /></div></div></div>)}</div></section><section className="panel"><div className="section-heading"><div><span className="eyebrow">Risk review</span><h2>Exception queue</h2></div><span className="queue-count">{data.reviewQueue.length} open</span></div>{data.reviewQueue.length ? <div className="alert-list">{data.reviewQueue.slice(0, 6).map((item) => <div className="review-row" key={item.id}><div className="review-icon"><ShieldAlert size={15} /></div><div><strong>{item.reason}</strong><span>{formatDate(item.createdAt)} · {item.attendanceId}</span></div><Badge value={item.severity} /></div>)}</div> : <EmptyState title="Queue is clear" text="No open device-risk or exception events require review." />}</section></div>
      </>}
    </div>
  );
}
