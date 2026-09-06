import React, { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Badge } from "../components/UI.jsx";
import { apiFetch } from "../context/api.js";

function isOverdue(dueDate) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dueDate);
  due.setHours(0, 0, 0, 0);
  return due < today;
}

export function FacultyAssignments() {
  const [assignments, setAssignments] = useState([]);
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  
  const [form, setForm] = useState({ title: "", description: "", className: "", dueDate: "" });
  const [message, setMessage] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [submissions, setSubmissions] = useState([]);

  useEffect(() => {
    async function fetchData() {
      try {
        const [assgnData, stuData] = await Promise.all([
          apiFetch("/faculty/assignments"),
          apiFetch("/faculty/students")
        ]);
        
        setAssignments(assgnData.assignments);
        setClasses(stuData.classes);
        if (stuData.classes.length > 0) {
          setForm(f => ({ ...f, className: stuData.classes[0] }));
        }
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  async function handleCreate(e) {
    e.preventDefault();
    setMessage("");
    setError("");
    try {
      const url = editingId ? `/faculty/assignments/${editingId}` : "/faculty/assignments";
      const method = editingId ? "PUT" : "POST";
      const { assignment } = await apiFetch(url, {
        method,
        body: JSON.stringify(form)
      });
      if (editingId) {
        setAssignments(prev => prev.map(a => a.id === editingId ? assignment : a));
        setMessage("Assignment updated successfully.");
      } else {
        setAssignments(prev => [...prev, assignment]);
        setMessage("Assignment created successfully.");
      }
      setForm({ ...form, title: "", description: "", dueDate: "" });
      setEditingId(null);
    } catch (err) {
      setError(err.message);
    }
  }

  function startEdit(a) {
    setEditingId(a.id);
    setForm({ title: a.title, description: a.description, className: a.className, dueDate: a.dueDate });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function cancelEdit() {
    setEditingId(null);
    setForm({ ...form, title: "", description: "", dueDate: "" });
    setError("");
    setMessage("");
  }

  async function toggleSubmissions(id) {
    if (expandedId === id) {
      setExpandedId(null);
      setSubmissions([]);
      return;
    }
    setExpandedId(id);
    setSubmissions([]);
    try {
      const data = await apiFetch(`/faculty/assignments/${id}/submissions`);
      setSubmissions(data.submissions);
    } catch (err) {
      console.error(err);
    }
  }

  async function handleDelete(id) {
    try {
      await apiFetch(`/faculty/assignments/${id}`, {
        method: "DELETE",
      });
      setAssignments(prev => prev.filter(a => a.id !== id));
    } catch (err) {
      alert("Failed to delete");
    }
  }

  async function evaluateSubmission(assignmentId, submission) {
    const marks = window.prompt(`Marks for ${submission.name} (0-100):`, submission.marks ?? "");
    if (marks === null) return;
    const feedback = window.prompt("Feedback (optional):", submission.feedback || "");
    if (feedback === null) return;
    try {
      await apiFetch(`/faculty/assignments/${assignmentId}/submissions/${submission.id}`, { method: "PUT", body: JSON.stringify({ marks: Number(marks), maxMarks: 100, feedback }) });
      const data = await apiFetch(`/faculty/assignments/${assignmentId}/submissions`);
      setSubmissions(data.submissions);
      setMessage("Submission evaluated.");
    } catch (err) { setError(err.message); }
  }

  if (loading) return <div>Loading...</div>;

  const overdueCount = assignments.filter(a => isOverdue(a.dueDate)).length;

  return (
    <div className="dashboard-content">
      {overdueCount > 0 && (
        <div className="warning-banner" style={{ marginBottom: '1rem' }}>
          <AlertTriangle size={18} />
          {overdueCount} of your assignment{overdueCount > 1 ? "s are" : " is"} now overdue.
        </div>
      )}
      <div className="card">
        <h2>{editingId ? "Edit Assignment" : "Create Assignment"}</h2>
        {message && <div className="success-box">{message}</div>}
        {error && <div className="error-box">{error}</div>}
        <form onSubmit={handleCreate} className="form-stack">
          <label>
            Title
            <input type="text" value={form.title} onChange={e => setForm({...form, title: e.target.value})} required />
          </label>
          <label>
            Description
            <textarea value={form.description} onChange={e => setForm({...form, description: e.target.value})} />
          </label>
          <label>
            Class
            <select value={form.className} onChange={e => setForm({...form, className: e.target.value})} required>
              {classes.map(cls => (
                <option key={cls} value={cls}>{cls}</option>
              ))}
            </select>
          </label>
          <label>
            Due Date
            <input type="date" value={form.dueDate} onChange={e => setForm({...form, dueDate: e.target.value})} required />
          </label>
          <div style={{ display: "flex", gap: "10px" }}>
            <button type="submit" className="primary-button">{editingId ? "Save Changes" : "Assign to Class"}</button>
            {editingId && (
              <button type="button" className="ghost-button" onClick={cancelEdit}>Cancel</button>
            )}
          </div>
        </form>
      </div>

      <div className="card">
        <h2>Your Assignments</h2>
        {assignments.length > 0 ? (
          <ul>
            {assignments.map(a => (
              <li key={a.id} style={{ marginBottom: '1rem', borderBottom: '1px solid #eee', paddingBottom: '1rem' }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <strong>{a.title}</strong> (Due: {a.dueDate}) - Class: {a.className}
                    {isOverdue(a.dueDate) && <span style={{ marginLeft: "8px" }}><Badge value="overdue" /></span>}
                    <p>{a.description}</p>
                  </div>
                  <div>
                    <button className="ghost-button" onClick={() => toggleSubmissions(a.id)}>
                      {expandedId === a.id ? "Hide Submissions" : "View Submissions"}
                    </button>
                    <button className="ghost-button" onClick={() => startEdit(a)}>Edit</button>
                    <button className="ghost-button" onClick={() => handleDelete(a.id)}>Delete</button>
                  </div>
                </div>
                {expandedId === a.id && (
                  <div style={{ marginTop: "12px", background: "var(--surface)", padding: "12px", borderRadius: "6px" }}>
                    <h4 style={{ margin: "0 0 8px 0" }}>Submissions ({submissions.filter(s => s.completed).length}/{submissions.length})</h4>
                    {submissions.length === 0 ? (
                      <p style={{ margin: 0, color: "var(--muted)" }}>No students found.</p>
                    ) : (
                      <div className="list-stack">
                        {submissions.map(sub => (
                          <div key={sub.id} className="list-row" style={{ alignItems: "flex-start" }}>
                            <div style={{ flex: 1 }}>
                              <strong>{sub.name}</strong> ({sub.rollNumber})
                              {sub.completed ? (
                                <div style={{ fontSize: "0.85rem", marginTop: "4px" }}>
                                  <span style={{ color: "var(--success)" }}>Completed {new Date(sub.completedAt).toLocaleString()}</span>
                                  {sub.submissionText && <p style={{ margin: "4px 0 0 0" }}>Note: {sub.submissionText}</p>}
                                  {sub.submissionLink && (
                                    <p style={{ margin: "4px 0 0 0" }}>
                                      Link: <a href={sub.submissionLink} target="_blank" rel="noreferrer" style={{ color: "var(--primary)" }}>{sub.submissionLink}</a>
                                    </p>
                                  )}
                                  {sub.submissionFile && <p style={{ margin: "4px 0 0" }}>File submitted: {sub.submissionFile.name}</p>}
                                  <button type="button" className="secondary-button" style={{ marginTop: "8px" }} onClick={() => evaluateSubmission(a.id, sub)}>{sub.evaluatedAt ? "Update evaluation" : "Evaluate submission"}</button>
                                  {sub.evaluatedAt && <p style={{ margin: "4px 0 0" }}>Score: {sub.marks}/{sub.maxMarks}{sub.feedback ? ` · ${sub.feedback}` : ""}</p>}
                                </div>
                              ) : (
                                <div style={{ fontSize: "0.85rem", color: "var(--muted)", marginTop: "4px" }}>Not completed</div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p>You haven't created any assignments yet.</p>
        )}
      </div>
    </div>
  );
}
