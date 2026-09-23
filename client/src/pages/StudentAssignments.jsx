import React, { useEffect, useState } from "react";
import { CheckCircle2, ClipboardList, Paperclip } from "lucide-react";
import { Badge, EmptyState } from "../components/UI.jsx";
import { apiFetch, downloadToFile } from "../context/api.js";
import { formatAssignmentDueDate, groupAssignmentsByStatus } from "../utils/assignments.js";

const GROUP_META = [
  { key: "overdue", label: "Overdue" },
  { key: "due-soon", label: "Due soon" },
  { key: "upcoming", label: "Upcoming" }
];

const MAX_FILES = 5;

function AssignmentRow({ assignment, onToggle, onUpload, busy }) {
  const [expanded, setExpanded] = useState(false);
  const [submissionText, setSubmissionText] = useState(assignment.submissionText || "");
  const [submissionLink, setSubmissionLink] = useState(assignment.submissionLink || "");
  const [files, setFiles] = useState([]);

  // Auto-expand once a submission exists server-side (e.g. after a reload), but
  // don't force-collapse otherwise — a student needs to be able to open this
  // panel themselves to attach work *before* anything has been submitted. It
  // used to be the other way around: the panel only rendered once
  // assignment.completed was already true, and the checkbox was the only way
  // to flip that, so opening the note/link/file fields meant checking the box
  // first and silently POSTing an empty completion record.
  useEffect(() => {
    if (assignment.completed) setExpanded(true);
  }, [assignment.completed]);

  const handleSave = () => {
    onToggle(assignment, { submissionText, submissionLink });
  };

  const submittedFiles = assignment.submissionFiles || [];
  const isGraded = Boolean(assignment.evaluatedAt);
  // A file submission is treated as final, and a graded submission is
  // locked too — mirrors "returned" work in Google Classroom. Note the
  // deadline itself no longer locks anything: turning work in late is
  // allowed, it's just marked "late" via assignment.status.
  const isFinalized = submittedFiles.length > 0;
  const locked = isGraded || isFinalized;
  const canAddMoreFiles = !isGraded && submittedFiles.length < MAX_FILES;
  const lockMessage = isGraded
    ? "This assignment has been graded — contact your teacher if you need to resubmit."
    : isFinalized
      ? canAddMoreFiles
        ? "Your note and link are locked in once a file is attached, but you can still attach more files below."
        : `You've attached the maximum of ${MAX_FILES} files — contact your teacher if you need to resubmit.`
      : "";

  return (
    <div className={`list-row assignment-row${assignment.completed ? " is-completed" : ""}`} style={{ flexDirection: "column", alignItems: "stretch", gap: "8px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: "12px", width: "100%" }}>
        <label className="assignment-checkbox">
          <input
            type="checkbox"
            checked={assignment.completed}
            disabled={busy || locked}
            onChange={() => onToggle(assignment)}
          />
        </label>
        <div style={{ flex: 1 }}>
          <strong>{assignment.title}</strong>
          <span>{assignment.className} · {assignment.teacherName} · Due: {formatAssignmentDueDate(assignment.dueDate)}</span>
          {assignment.description && (
            <p style={{ margin: "6px 0 0", fontSize: "0.9rem", color: "var(--muted)" }}>{assignment.description}</p>
          )}
          {assignment.attachments?.length > 0 && (
            <div style={{ margin: "6px 0 0", display: "flex", flexWrap: "wrap", gap: "10px" }}>
              {assignment.attachments.map((att) => (
                <button
                  key={att.id}
                  type="button"
                  className="link-button"
                  onClick={() => downloadToFile(`/shared/assignments/${assignment.id}/attachments/${att.id}`, att.name)}
                >
                  <Paperclip size={12} style={{ verticalAlign: "middle", marginRight: "4px" }} />{att.name}
                </button>
              ))}
            </div>
          )}
          {assignment.status === "overdue" && !assignment.completed && (
            <p className="helper-text" style={{ color: "var(--danger, #d64545)", margin: "4px 0 0" }}>
              Deadline passed — you can still submit, but it will be marked late.
            </p>
          )}
          {isGraded && (
            <p className="helper-text" style={{ margin: "4px 0 0" }}>
              Grade: <strong>{assignment.marks} / {assignment.maxMarks}</strong>
              {assignment.feedback ? ` · ${assignment.feedback}` : ""}
            </p>
          )}
        </div>
        <Badge value={assignment.status} />
        {!assignment.completed && (
          <button
            type="button"
            className="link-button"
            style={{ alignSelf: "flex-start" }}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? "Close" : "Add submission"}
          </button>
        )}
      </div>

      {expanded && (
        <div className="form-stack" style={{ marginLeft: "32px", padding: "12px", background: "var(--surface)", borderRadius: "6px", marginTop: "4px" }}>
          {lockMessage && <div className="helper-text" style={{ color: "var(--danger, #d64545)" }}>{lockMessage}</div>}
          <label style={{ fontSize: "0.85rem" }}>
            Submission Note (optional)
            <textarea
              placeholder="What did you do?"
              value={submissionText}
              onChange={(e) => setSubmissionText(e.target.value)}
              rows={2}
              style={{ fontSize: "0.9rem" }}
              disabled={locked}
            />
          </label>
          <label style={{ fontSize: "0.85rem" }}>
            Link (optional)
            <input
              type="url"
              placeholder="https://..."
              value={submissionLink}
              onChange={(e) => setSubmissionLink(e.target.value)}
              style={{ fontSize: "0.9rem" }}
              disabled={locked}
            />
          </label>
          {canAddMoreFiles && (
            <label style={{ fontSize: "0.85rem" }}>
              Attach files (PDF, PNG, or JPEG; up to {MAX_FILES - submittedFiles.length} more, 5 MB each)
              <input
                type="file"
                accept="application/pdf,image/png,image/jpeg"
                multiple
                onChange={(e) => setFiles(Array.from(e.target.files || []).slice(0, MAX_FILES - submittedFiles.length))}
              />
            </label>
          )}
          <button
            type="button"
            className="secondary-button"
            style={{ alignSelf: "flex-start", marginTop: "4px" }}
            onClick={handleSave}
            disabled={busy || locked}
          >
            Save Submission
          </button>
          {files.length > 0 && (
            <button
              type="button"
              className="secondary-button"
              style={{ alignSelf: "flex-start" }}
              onClick={() => onUpload(assignment, files)}
              // File uploads are only refused server-side once the submission is
              // graded (evaluatedAt) — a student can call the upload endpoint again
              // later to add more files, up to MAX_FILES total. `locked` also turns
              // true as soon as the first file is uploaded (it governs the text/link
              // fields, which the server *does* freeze once any file exists), so
              // gating this button on `locked` made it impossible to ever add a
              // second batch of files even though the input stayed visible.
              disabled={busy || isGraded}
            >
              Upload {files.length} file{files.length > 1 ? "s" : ""}
            </button>
          )}
          {submittedFiles.length > 0 && (
            <div className="helper-text" style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              {submittedFiles.map((file) => (
                <span key={file.storedName}>
                  Submitted: {file.name} ·{" "}
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => downloadToFile(`/shared/student/assignments/${assignment.id}/submission/file/${file.storedName}`, file.name)}
                  >
                    Download
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function StudentAssignments() {
  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [showCompleted, setShowCompleted] = useState(false);

  async function loadAssignments() {
    try {
      const data = await apiFetch("/shared/student/assignments");
      setAssignments(data.assignments || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAssignments();
  }, []);

  async function handleToggle(assignment, submissionData = null) {
    setBusyId(assignment.id);
    setError("");
    try {
      const method = (!submissionData && assignment.completed) ? "DELETE" : "POST";
      const body = submissionData ? JSON.stringify(submissionData) : undefined;
      await apiFetch(`/shared/student/assignments/${assignment.id}/complete`, {
        method,
        body
      });
      await loadAssignments();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function handleUpload(assignment, files) {
    setBusyId(assignment.id);
    setError("");
    try {
      const body = new FormData();
      for (const file of files) body.append("files", file);
      await apiFetch(`/shared/student/assignments/${assignment.id}/submission`, { method: "POST", body });
      await loadAssignments();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <div className="panel">Loading assignments...</div>;

  const groups = groupAssignmentsByStatus(assignments);
  const hasAny = assignments.length > 0;

  return (
    <div className="page-stack">
      <section className="panel">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Tasks</span>
            <h2>Your assignments</h2>
          </div>
          <ClipboardList size={22} />
        </div>
        {error && <div className="error-box">{error}</div>}

        {!hasAny && (
          <EmptyState title="No assignments yet" text="Anything your teachers assign to your class will show up here." />
        )}

        {hasAny && (
          <div className="list-stack">
            {GROUP_META.map(({ key, label }) =>
              groups[key].length > 0 && (
                <div key={key}>
                  <span className="eyebrow">{label} ({groups[key].length})</span>
                  <div className="list-stack" style={{ marginTop: "8px" }}>
                    {groups[key].map((assignment) => (
                      <AssignmentRow
                        key={assignment.id}
                        assignment={assignment}
                        onToggle={handleToggle}
                        onUpload={handleUpload}
                        busy={busyId === assignment.id}
                      />
                    ))}
                  </div>
                </div>
              )
            )}

            {groups.completed.length > 0 && (
              <div>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => setShowCompleted((prev) => !prev)}
                >
                  <CheckCircle2 size={16} />
                  {showCompleted ? "Hide" : "Show"} completed ({groups.completed.length})
                </button>
                {showCompleted && (
                  <div className="list-stack" style={{ marginTop: "8px" }}>
                    {groups.completed.map((assignment) => (
                      <AssignmentRow
                        key={assignment.id}
                        assignment={assignment}
                        onToggle={handleToggle}
                        onUpload={handleUpload}
                        busy={busyId === assignment.id}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
