import React, { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Download, Lock, LockOpen, Save, Send } from "lucide-react";
import { EmptyState, StatCard } from "../components/UI.jsx";
import { GradeBadge, SheetStatusBadge } from "../components/MarksBadges.jsx";
import { apiFetch, downloadToFile } from "../context/api.js";

const STATUS_TEXT = {
  draft: "Draft - only you and admins can see these marks. Students see nothing until you publish.",
  published: "Published - students can see these results. Marks are read-only; a Head of Department or admin can lock the sheet, and only an admin can reopen it.",
  locked: "Locked - final. Only an admin can unlock it, and a reason is required."
};

const toText = (value) => (value === null || value === undefined ? "" : String(value));
const toValue = (text) => (String(text).trim() === "" ? null : String(text).trim());
const formatWhen = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "");

function initialEdits(students) {
  return Object.fromEntries(students.map((item) => [item.studentId, { internal: toText(item.internal), endSem: toText(item.endSem), absent: item.absent, remarks: item.remarks }]));
}

// Same rule as the server (which is authoritative at publish); this is only a live preview.
function previewGrade(edit, limits, scale) {
  const internal = toValue(edit.internal);
  const endSem = toValue(edit.endSem);
  const internalOk = limits.internalMax === 0 || internal !== null;
  const endSemOk = limits.endSemMax === 0 || edit.absent || endSem !== null;
  if (!internalOk || !endSemOk) return null;
  const iNum = Number(internal ?? 0);
  const eNum = edit.absent ? 0 : Number(endSem ?? 0);
  if ([iNum, eNum].some((n) => !Number.isFinite(n) || n < 0 || n * 2 !== Math.round(n * 2)) || iNum > limits.internalMax || eNum > limits.endSemMax) return "invalid";
  const total = iNum + eNum;
  const max = limits.internalMax + limits.endSemMax;
  const band = edit.absent ? scale[scale.length - 1] : scale.find((item) => total * 100 >= item.min * max) || scale[scale.length - 1];
  return { total, max, grade: band.grade, points: band.points };
}

export function MarksSheet() {
  const { subjectId } = useParams();
  const [view, setView] = useState(null);
  const [edits, setEdits] = useState({});
  const [limits, setLimits] = useState({ internalMax: "40", endSemMax: "60" });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState("success");
  const [missing, setMissing] = useState([]);
  const [unlocking, setUnlocking] = useState(false);
  const [reason, setReason] = useState("");

  function applyView(next) {
    setView(next);
    setEdits(initialEdits(next.students));
    setLimits({ internalMax: String(next.sheet.internalMax), endSemMax: String(next.sheet.endSemMax) });
  }

  useEffect(() => {
    setLoading(true);
    apiFetch(`/marks/sheet/${subjectId}`)
      .then(applyView)
      .catch((error) => { setMessage(error.message); setMessageType("error"); })
      .finally(() => setLoading(false));
  }, [subjectId]);

  const server = useMemo(() => (view ? initialEdits(view.students) : {}), [view]);
  const changedIds = useMemo(() => (view ? view.students.filter((item) => {
    const a = edits[item.studentId]; const b = server[item.studentId];
    return a && b && (a.internal !== b.internal || a.endSem !== b.endSem || a.absent !== b.absent || a.remarks !== b.remarks);
  }).map((item) => item.studentId) : []), [view, edits, server]);
  const limitsChanged = view && (limits.internalMax !== String(view.sheet.internalMax) || limits.endSemMax !== String(view.sheet.endSemMax));
  const dirty = changedIds.length > 0 || Boolean(limitsChanged);
  const numericLimits = { internalMax: Number(limits.internalMax), endSemMax: Number(limits.endSemMax) };

  function setEdit(studentId, patch) {
    setEdits((old) => ({ ...old, [studentId]: { ...old[studentId], ...patch } }));
  }

  function report(text, type = "success") {
    setMessage(text);
    setMessageType(type);
  }

  async function save() {
    const body = {};
    if (limitsChanged) { body.internalMax = limits.internalMax; body.endSemMax = limits.endSemMax; }
    if (changedIds.length) body.entries = changedIds.map((studentId) => ({ studentId, internal: toValue(edits[studentId].internal), endSem: edits[studentId].absent ? null : toValue(edits[studentId].endSem), absent: edits[studentId].absent, remarks: edits[studentId].remarks }));
    const next = await apiFetch(`/marks/sheet/${subjectId}`, { method: "PUT", body: JSON.stringify(body) });
    applyView(next);
    return next;
  }

  async function run(action, successText) {
    setBusy(true);
    setMessage("");
    setMissing([]);
    try {
      await action();
      if (successText) report(successText);
    } catch (error) {
      report(error.message, "error");
      if (error.details?.missing) setMissing(error.details.missing);
    } finally {
      setBusy(false);
    }
  }

  const saveDraft = () => run(async () => { await save(); }, "Marks saved.");

  function publish() {
    if (!window.confirm("Publish these marks? Students will see their grades immediately, and the marks become read-only. Only an admin can reopen a published sheet.")) return;
    run(async () => {
      if (dirty) await save();
      const next = await apiFetch(`/marks/sheet/${subjectId}/publish`, { method: "POST", body: JSON.stringify({}) });
      applyView(next);
    }, "Results published.");
  }

  function lock() {
    if (!window.confirm("Lock these results? Marks can then only be changed by an admin who unlocks the sheet with a recorded reason.")) return;
    run(async () => applyView(await apiFetch(`/marks/sheet/${subjectId}/lock`, { method: "POST", body: JSON.stringify({}) })), "Results locked.");
  }

  function unlock() {
    run(async () => {
      applyView(await apiFetch(`/marks/sheet/${subjectId}/unlock`, { method: "POST", body: JSON.stringify({ reason }) }));
      setUnlocking(false);
      setReason("");
    }, "Sheet reopened. Results are hidden from students until it is published again.");
  }

  if (loading) return <div className="panel"><p>Loading mark sheet…</p></div>;
  if (!view) return <div className="page-stack"><div role="alert" className="error-box">{message || "Mark sheet not found."}</div><Link className="secondary-button" to="/marks"><ArrowLeft size={15} /> Back to subjects</Link></div>;

  const { subject, sheet, access, readiness } = view;
  const editable = access.canEdit;
  const completeCount = view.students.filter((item) => item.complete).length;
  const passCount = view.students.filter((item) => item.outcome?.passed).length;

  return (
    <div className="page-stack">
      <section className="stats-grid">
        <StatCard label="Students" value={view.students.length} hint={subject.className} tone="blue" />
        <StatCard label="Complete rows" value={`${completeCount}/${view.students.length}`} hint="Required before publishing" tone={completeCount === view.students.length ? "green" : "amber"} />
        <StatCard label="Passed" value={sheet.status === "draft" ? "—" : `${passCount}/${view.students.length}`} hint={`Pass mark ${view.passPercentage}%`} tone="green" />
        <StatCard label="Credits" value={subject.credits ?? "—"} hint={subject.semester ? `Semester ${subject.semester}` : "Semester not set"} tone="blue" />
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <span className="eyebrow">{subject.code} · {subject.className}</span>
            <h2>{subject.subjectName}</h2>
          </div>
          <SheetStatusBadge status={sheet.status} />
        </div>
        <p className="muted-text">{STATUS_TEXT[sheet.status]}</p>
        {message && <div role="status" className={messageType === "error" ? "error-box" : "success-box"}>{message}</div>}
        {missing.length > 0 && <div className="error-box">Missing or invalid: {missing.map((item) => `${item.rollNumber} ${item.name}`).join(", ")}{missing.length >= 50 ? "…" : ""}</div>}
        {readiness.problems.length > 0 && <div className="error-box">{readiness.problems.map((item) => <div key={item}>{item}</div>)}</div>}

        <div className="marks-bar">
          <Link className="secondary-button" to="/marks"><ArrowLeft size={15} /> All subjects</Link>
          <label>
            Internal max
            <input className="marks-max" type="number" min="0" max="500" step="1" value={limits.internalMax} disabled={!editable} onChange={(e) => setLimits({ ...limits, internalMax: e.target.value })} />
          </label>
          <label>
            End-sem max
            <input className="marks-max" type="number" min="0" max="500" step="1" value={limits.endSemMax} disabled={!editable} onChange={(e) => setLimits({ ...limits, endSemMax: e.target.value })} />
          </label>
          {access.canEdit && <button className="secondary-button" type="button" disabled={busy || !dirty} onClick={saveDraft}><Save size={15} /> Save draft</button>}
          {access.canPublish && <button className="primary-button" type="button" disabled={busy || (!readiness.ready && !dirty)} onClick={publish}><Send size={15} /> Publish results</button>}
          {access.canLock && <button className="primary-button" type="button" disabled={busy} onClick={lock}><Lock size={15} /> Lock results</button>}
          {access.canUnlock && !unlocking && <button className="secondary-button danger-text" type="button" disabled={busy} onClick={() => setUnlocking(true)}><LockOpen size={15} /> Unlock…</button>}
          <button className="secondary-button" type="button" onClick={() => downloadToFile(`/marks/sheet/${subjectId}/export.csv`, `marks-${subject.code}.csv`).catch(() => {})}><Download size={15} /> CSV</button>
          <button className="secondary-button" type="button" onClick={() => downloadToFile(`/marks/sheet/${subjectId}/export.pdf`, `marks-${subject.code}.pdf`).catch(() => {})}><Download size={15} /> PDF</button>
        </div>

        {unlocking && (
          <div className="admin-form">
            <label className="span-two">
              Reason for reopening (recorded in the audit log; results are hidden from students until republished)
              <input value={reason} onChange={(e) => setReason(e.target.value)} minLength={5} maxLength={300} placeholder="e.g. Re-evaluation of paper 2" autoFocus />
            </label>
            <button className="secondary-button danger-text" type="button" disabled={busy || reason.trim().length < 5} onClick={unlock}>Confirm unlock</button>
            <button className="secondary-button" type="button" onClick={() => { setUnlocking(false); setReason(""); }}>Cancel</button>
          </div>
        )}

        {view.students.length ? (
          <div className="table-wrap">
            <table className="marks-table">
              <thead>
                <tr><th>Roll no.</th><th>Student</th><th>Internal /{sheet.internalMax}</th><th>End-sem /{sheet.endSemMax}</th><th>Absent</th><th>Remarks</th><th>Total</th><th>Grade</th></tr>
              </thead>
              <tbody>
                {view.students.map((item) => {
                  const edit = edits[item.studentId] || initialEdits([item])[item.studentId];
                  const live = editable ? previewGrade(edit, numericLimits, view.gradeScale) : item.outcome && { total: item.outcome.totalMarks, max: item.outcome.totalMax, grade: item.outcome.grade, points: item.outcome.gradePoints };
                  const invalid = live === "invalid";
                  return (
                    <tr key={item.studentId}>
                      <td>{item.rollNumber}</td>
                      <td>{item.name}{item.missingResult && <span className="marks-warn">No published result - reopen to include</span>}</td>
                      <td><input className={`marks-input${invalid ? " invalid" : ""}`} type="number" inputMode="decimal" min="0" max={sheet.internalMax} step="0.5" value={edit.internal} disabled={!editable || sheet.internalMax === 0} onChange={(e) => setEdit(item.studentId, { internal: e.target.value })} aria-label={`Internal marks for ${item.name}`} /></td>
                      <td><input className={`marks-input${invalid ? " invalid" : ""}`} type="number" inputMode="decimal" min="0" max={sheet.endSemMax} step="0.5" value={edit.absent ? "" : edit.endSem} disabled={!editable || edit.absent || sheet.endSemMax === 0} onChange={(e) => setEdit(item.studentId, { endSem: e.target.value })} aria-label={`End-semester marks for ${item.name}`} /></td>
                      <td><input type="checkbox" checked={edit.absent} disabled={!editable} onChange={(e) => setEdit(item.studentId, { absent: e.target.checked, endSem: e.target.checked ? "" : edit.endSem })} aria-label={`${item.name} was absent for the end-semester exam`} /></td>
                      <td><input className="marks-remarks" value={edit.remarks} maxLength={200} disabled={!editable} onChange={(e) => setEdit(item.studentId, { remarks: e.target.value })} aria-label={`Remarks for ${item.name}`} /></td>
                      <td>{live && !invalid ? `${live.total}/${live.max}` : "—"}</td>
                      <td>{live && !invalid ? <GradeBadge grade={live.grade} absent={edit.absent} /> : invalid ? <span className="marks-warn">Invalid</span> : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="No students in this class" text="Nothing can be published until students are enrolled in this class." />
        )}
        {editable && <p className="muted-text">Marks go in steps of 0.5. Tick <strong>Absent</strong> if the student missed the end-semester exam: they get grade F and only internal marks are kept. Grades shown while editing are a preview; the server calculates the final grade on publish.</p>}
      </section>

      {sheet.history.length > 0 && (
        <section className="panel">
          <div className="section-heading"><div><span className="eyebrow">Audit trail</span><h2>Sheet history</h2></div></div>
          <div className="list-stack">
            {sheet.history.map((entry, index) => (
              <div className="list-row" key={`${entry.at}-${index}`}>
                <div>
                  <strong>{entry.action === "unlock" ? `Unlocked (was ${entry.fromStatus})` : entry.action === "publish" ? "Published" : "Locked"}</strong>
                  <span>{entry.by?.name || "Unknown"} · {formatWhen(entry.at)}{entry.reason ? ` · Reason: ${entry.reason}` : ""}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
