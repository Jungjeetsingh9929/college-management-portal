import React, { useEffect, useMemo, useState } from "react";
import { CheckCircle2, ClipboardCheck, Clock3, Loader2, ShieldCheck, UserCheck, XCircle } from "lucide-react";
import { apiFetch } from "../context/api.js";
import { useAuth } from "../context/AuthContext.jsx";
import { Badge, EmptyState } from "../components/UI.jsx";

const statusOptions = [
  { value: "present", label: "Present", icon: CheckCircle2, tone: "present" },
  { value: "late", label: "Late", icon: Clock3, tone: "late" },
  { value: "excused", label: "Excused", icon: ShieldCheck, tone: "excused" },
  { value: "absent", label: "Absent", icon: XCircle, tone: "absent" }
];

export function MarkAttendance() {
  const { user } = useAuth();
  const [subjects, setSubjects] = useState([]); const [subjectId, setSubjectId] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().split("T")[0]); const [roster, setRoster] = useState(null);
  const [loadingSubjects, setLoadingSubjects] = useState(true); const [loadingRoster, setLoadingRoster] = useState(false); const [updatingId, setUpdatingId] = useState(null); const [error, setError] = useState("");
  useEffect(() => { async function loadSubjects() { try { const subjectData = await apiFetch("/subjects"); let list = subjectData.subjects || []; if (user.role === "teacher") { const facultyData = await apiFetch("/faculty/students"); list = list.filter((subject) => (facultyData.classes || []).includes(subject.className)); } setSubjects(list); if (list.length) setSubjectId(list[0].id); } catch (err) { setError(err.message); } finally { setLoadingSubjects(false); } } loadSubjects(); }, [user.role]);
  async function loadRoster() { if (!subjectId) return; setLoadingRoster(true); setError(""); try { setRoster(await apiFetch(`/attendance/roster?subjectId=${subjectId}&date=${date}`)); } catch (err) { setError(err.message); setRoster(null); } finally { setLoadingRoster(false); } }
  useEffect(() => { loadRoster(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subjectId, date]);
  async function markStudent(studentId, status) { setUpdatingId(studentId); setError(""); try { await apiFetch("/attendance/mark", { method: "POST", body: JSON.stringify({ studentId, subjectId, status, date }) }); await loadRoster(); } catch (err) { setError(err.message); } finally { setUpdatingId(null); } }
  const summary = useMemo(() => (roster?.roster || []).reduce((acc, student) => { acc.total += 1; if (student.status) acc[student.status] = (acc[student.status] || 0) + 1; return acc; }, { total: 0, present: 0, late: 0, excused: 0, absent: 0 }), [roster]);
  return <div className="page-stack manual-attendance">
    <section className="attendance-hero manual-hero"><div><span className="eyebrow">Staff workspace / controlled entry</span><h2>Mark attendance</h2><p>Record a defensible attendance state for every enrolled student. Each update is timestamped and preserved in the audit history.</p></div><div className="manual-hero-icon"><ClipboardCheck size={28} /></div></section>
    <section className="panel attendance-filters"><div className="section-heading"><div><span className="eyebrow">Class context</span><h2>Choose a roster</h2></div><UserCheck size={20} color="var(--blue)" /></div>{loadingSubjects ? <p className="muted">Loading assigned subjects…</p> : subjects.length ? <div className="manual-filter-grid"><label>Subject<select value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>{subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.subjectName} ({subject.code}) · {subject.className}</option>)}</select></label><label>Attendance date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label></div> : <EmptyState title="No subjects available" text={user.role === "teacher" ? "You are not assigned to any classes yet." : "No subjects have been set up yet."} />}{error && <div className="warning-banner"><XCircle size={18} /><span>{error}</span></div>}</section>
    {subjects.length > 0 && <section className="panel roster-panel"><div className="section-heading"><div><span className="eyebrow">{roster?.date || date} · {summary.total} enrolled</span><h2>{roster?.subject ? `${roster.subject.subjectName} · ${roster.subject.className}` : "Class roster"}</h2></div><div className="roster-summary">{statusOptions.map((option) => <span key={option.value}><i className={`summary-dot ${option.tone}`} /> {summary[option.value] || 0}</span>)}</div></div>{loadingRoster ? <div className="loading-panel">Loading roster…</div> : roster?.roster?.length ? <div className="roster-list">{roster.roster.map((student) => <article className="roster-row" key={student.studentId}><div className="student-identity"><span className="student-initial">{student.name.slice(0, 1)}</span><div><strong>{student.name}</strong><span>{student.rollNumber} · {student.status ? `Updated ${student.time || "today"}` : "Not marked"}</span></div></div><div className="attendance-actions">{student.status && <Badge value={student.status} />}{statusOptions.map((option) => { const Icon = option.icon; return <button key={option.value} className={`status-button ${option.tone} ${student.status === option.value ? "selected" : ""}`} disabled={updatingId === student.studentId} onClick={() => markStudent(student.studentId, option.value)} title={`Mark ${option.label.toLowerCase()}`}><Icon size={14} /><span>{option.label}</span></button>; })}{updatingId === student.studentId && <Loader2 size={16} className="spin" />}</div></article>)}</div> : <EmptyState title="No students found" text="There are no students enrolled in this class yet." />}</section>}
  </div>;
}
