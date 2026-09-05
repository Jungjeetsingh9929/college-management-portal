import React, { useEffect, useState } from "react";
import { CheckCircle2, ClipboardList } from "lucide-react";
import { Badge, EmptyState } from "../components/UI.jsx";
import { apiFetch } from "../context/api.js";
import { groupAssignmentsByStatus } from "../utils/assignments.js";

const GROUP_META = [
  { key: "overdue", label: "Overdue" },
  { key: "due-soon", label: "Due soon" },
  { key: "upcoming", label: "Upcoming" }
];

function AssignmentRow({ assignment, onToggle, busy }) {
  const [expanded, setExpanded] = useState(false);
  const [submissionText, setSubmissionText] = useState(assignment.submissionText || "");
  const [submissionLink, setSubmissionLink] = useState(assignment.submissionLink || "");

  useEffect(() => {
    if (assignment.completed) setExpanded(true);
    else setExpanded(false);
  }, [assignment.completed]);

  const handleSave = () => {
    onToggle(assignment, { submissionText, submissionLink });
  };

  return (
    <div className={`list-row assignment-row${assignment.completed ? " is-completed" : ""}`} style={{ flexDirection: "column", alignItems: "stretch", gap: "8px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: "12px", width: "100%" }}>
        <label className="assignment-checkbox">
          <input
            type="checkbox"
            checked={assignment.completed}
            disabled={busy}
            onChange={() => onToggle(assignment)}
          />
        </label>
        <div style={{ flex: 1 }}>
          <strong>{assignment.title}</strong>
          <span>{assignment.className} · {assignment.teacherName} · Due: {assignment.dueDate}</span>
          {assignment.description && (
            <p style={{ margin: "6px 0 0", fontSize: "0.9rem", color: "var(--muted)" }}>{assignment.description}</p>
          )}
        </div>
        <Badge value={assignment.status} />
      </div>
      
      {expanded && assignment.completed && (
        <div className="form-stack" style={{ marginLeft: "32px", padding: "12px", background: "var(--surface)", borderRadius: "6px", marginTop: "4px" }}>
          <label style={{ fontSize: "0.85rem" }}>
            Submission Note (optional)
            <textarea
              placeholder="What did you do?"
              value={submissionText}
              onChange={(e) => setSubmissionText(e.target.value)}
              rows={2}
              style={{ fontSize: "0.9rem" }}
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
            />
          </label>
          <button 
            type="button" 
            className="secondary-button" 
            style={{ alignSelf: "flex-start", marginTop: "4px" }} 
            onClick={handleSave}
            disabled={busy}
          >
            Save Submission
          </button>
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
