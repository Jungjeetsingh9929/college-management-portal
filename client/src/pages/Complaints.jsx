import React, { useEffect, useMemo, useState } from "react";
import { ClipboardList, MessageSquarePlus, Save } from "lucide-react";
import { Badge, EmptyState, StatCard } from "../components/UI.jsx";
import { apiFetch } from "../context/api.js";
import { useAuth } from "../context/AuthContext.jsx";

const blankComplaint = {
  title: "",
  category: "Classroom",
  location: "",
  priority: "medium",
  description: ""
};

const statusOptions = ["pending", "in-progress", "resolved"];
const priorityOptions = ["low", "medium", "high"];
const categoryOptions = ["Classroom", "Network", "Library", "Hostel", "Transport", "Other"];

export function Complaints() {
  const { user } = useAuth();
  const [complaints, setComplaints] = useState([]);
  const [form, setForm] = useState(blankComplaint);
  const [statusFilter, setStatusFilter] = useState("");
  const [message, setMessage] = useState("");

  async function loadComplaints() {
    const data = await apiFetch("/complaints");
    setComplaints(data.complaints);
  }

  useEffect(() => {
    loadComplaints();
  }, []);

  const visibleComplaints = useMemo(() => {
    if (!statusFilter) return complaints;
    return complaints.filter((complaint) => complaint.status === statusFilter);
  }, [complaints, statusFilter]);

  const stats = useMemo(() => {
    return {
      total: complaints.length,
      pending: complaints.filter((item) => item.status === "pending").length,
      progress: complaints.filter((item) => item.status === "in-progress").length,
      resolved: complaints.filter((item) => item.status === "resolved").length
    };
  }, [complaints]);

  async function submitComplaint(event) {
    event.preventDefault();
    setMessage("");
    try {
      const data = await apiFetch("/complaints", { method: "POST", body: JSON.stringify(form) });
      setMessage(data.message);
      setForm(blankComplaint);
      loadComplaints();
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function updateComplaint(id, patch) {
    const data = await apiFetch(`/complaints/${id}`, { method: "PUT", body: JSON.stringify(patch) });
    setMessage(data.message);
    loadComplaints();
  }

  return (
    <div className="page-stack">
      <section className="stats-grid">
        <StatCard label="Total complaints" value={stats.total} hint="All records" tone="blue" />
        <StatCard label="Pending" value={stats.pending} hint="Waiting" tone="amber" />
        <StatCard label="In progress" value={stats.progress} hint="Being handled" tone="green" />
        <StatCard label="Resolved" value={stats.resolved} hint="Closed" tone="red" />
      </section>

      {user.role === "student" && (
        <section className="panel">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Complaint tracker</span>
              <h2>Submit a complaint</h2>
            </div>
            <MessageSquarePlus size={22} />
          </div>
          <form className="admin-form" onSubmit={submitComplaint}>
            <label>
              Title
              <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
            </label>
            <label>
              Category
              <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {categoryOptions.map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
            <label>
              Location
              <input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
            </label>
            <label>
              Priority
              <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                {priorityOptions.map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
            <label className="span-two">
              Description
              <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} required />
            </label>
            <button className="primary-button" type="submit">
              <Save size={17} />
              Submit complaint
            </button>
          </form>
          {message && <div className={message.includes("required") ? "error-box" : "success-box"}>{message}</div>}
        </section>
      )}

      <section className="panel">
        <div className="section-heading">
          <div>
            <span className="eyebrow">{user.role === "admin" ? "Admin desk" : "My requests"}</span>
            <h2>{user.role === "admin" ? "Manage complaints" : "Complaint status"}</h2>
          </div>
          <ClipboardList size={22} />
        </div>
        <div className="toolbar single-control">
          <label>
            Status filter
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All</option>
              {statusOptions.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
        </div>
        {visibleComplaints.length ? (
          <div className="complaint-list">
            {visibleComplaints.map((complaint) => (
              <article className="complaint-card" key={complaint.id}>
                <div className="complaint-top">
                  <div>
                    <strong>{complaint.title}</strong>
                    <span>{complaint.category} · {complaint.location || "No location"}</span>
                    {user.role === "admin" && <span>{complaint.studentName} · {complaint.rollNumber}</span>}
                  </div>
                  <div className="badge-row">
                    <Badge value={complaint.priority} />
                    <Badge value={complaint.status} />
                  </div>
                </div>
                <p>{complaint.description}</p>
                {complaint.response && <div className="response-box">{complaint.response}</div>}
                {user.role === "admin" && (
                  <div className="admin-complaint-controls">
                    <select value={complaint.status} onChange={(e) => updateComplaint(complaint.id, { status: e.target.value })}>
                      {statusOptions.map((item) => <option key={item} value={item}>{item}</option>)}
                    </select>
                    <select value={complaint.priority} onChange={(e) => updateComplaint(complaint.id, { priority: e.target.value })}>
                      {priorityOptions.map((item) => <option key={item} value={item}>{item}</option>)}
                    </select>
                    <input
                      placeholder="Admin response"
                      defaultValue={complaint.response}
                      onBlur={(e) => updateComplaint(complaint.id, { response: e.target.value })}
                    />
                  </div>
                )}
              </article>
            ))}
          </div>
        ) : (
          <EmptyState title="No complaints found" text="Complaint records will appear here." />
        )}
      </section>
    </div>
  );
}
