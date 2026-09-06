import React, { useEffect, useMemo, useState } from "react";
import { Edit3, Plus, Save, Search, Trash2, X } from "lucide-react";
import { Badge, DashboardSkeleton, ErrorState, Modal, StatCard, useToast } from "../components/UI.jsx";
import { apiFetch } from "../context/api.js";

const blankStudent = {
  name: "",
  rollNumber: "",
  className: "CSE 3A",
  department: "Computer Science",
  email: "",
  password: "",
  phone: "",
  guardian: "",
  graduationYear: "2028"
};

const studentLabels = {
  name: "Student Name",
  rollNumber: "Roll / Enrollment No.",
  className: "Class / Section",
  department: "Department",
  email: "Email",
  graduationYear: "Graduation Year"
};

export function AdminDashboard() {
  const [summary, setSummary] = useState(null);
  const [students, setStudents] = useState([]);
  const [pendingRequests, setPendingRequests] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [adminOverview, setAdminOverview] = useState(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [form, setForm] = useState(blankStudent);
  const [editingStudentId, setEditingStudentId] = useState("");
  const [showStudentModal, setShowStudentModal] = useState(false);
  const [loadError, setLoadError] = useState("");
  const { showToast } = useToast() || {};

  async function loadData() {
    try {
      setLoadError("");
      const [summaryData, studentData, subjectData, pendingData, assignmentsData, overviewData] = await Promise.all([
        apiFetch("/attendance/summary"),
        apiFetch("/students"),
        apiFetch("/subjects"),
        apiFetch("/students/pending"),
        apiFetch("/admin/assignments").catch(() => ({ assignments: [] })),
        apiFetch("/admin/overview").catch(() => null)
      ]);
      setSummary(summaryData);
      setStudents(studentData.students);
      setSubjects(subjectData.subjects);
      setPendingRequests(pendingData.requests);
      setAssignments(assignmentsData.assignments || []);
      setAdminOverview(overviewData);
    } catch (error) {
      setLoadError(error.message || "Unable to load dashboard data.");
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  const filteredStudents = useMemo(() => {
    return students.filter((student) =>
      [student.name, student.rollNumber, student.email]
        .join(" ")
        .toLowerCase()
        .includes(query.toLowerCase()) && (!statusFilter || (statusFilter === "inactive" ? student.active === false : (student.approvalStatus || "approved") === statusFilter && student.active !== false))
    );
  }, [students, query, statusFilter]);

  async function saveStudent(event) {
    event.preventDefault();
    const wasEditing = Boolean(editingStudentId);
    const path = editingStudentId ? `/students/${editingStudentId}` : "/students";
    await apiFetch(path, { method: editingStudentId ? "PUT" : "POST", body: JSON.stringify(form) });
    setForm(blankStudent);
    setEditingStudentId("");
    setShowStudentModal(false);
    showToast?.(wasEditing ? "Student updated successfully." : "Student added successfully.", "success");
    await loadData();
  }

  function editStudent(student) {
    setEditingStudentId(student.id);
    setForm({
      name: student.name,
      rollNumber: student.rollNumber,
      className: student.className,
      department: student.department,
      email: student.email,
      password: "",
      phone: student.phone || "",
      guardian: student.guardian || "",
      graduationYear: student.graduationYear || "2028"
    });
    setShowStudentModal(true);
  }

  async function approveStudentRequest(id) {
    await apiFetch(`/students/pending/${id}/approve`, { method: "POST" });
    await loadData();
    showToast?.("Student request approved.", "success");
  }

  async function rejectStudentRequest(id) {
    await apiFetch(`/students/pending/${id}/reject`, { method: "POST", body: JSON.stringify({ reason: "Rejected by admin" }) });
    await loadData();
    showToast?.("Student request rejected.", "success");
  }

  async function deleteStudent(id) {
    if (!window.confirm("Delete this student? This cannot be undone.")) return;
    await apiFetch(`/students/${id}`, { method: "DELETE" });
    await loadData();
    showToast?.("Student deleted.", "success");
  }

  async function toggleStudent(student) {
    await apiFetch(`/students/${student.id}/status`, { method: "PATCH", body: JSON.stringify({ active: student.active === false }) });
    await loadData();
    showToast?.(student.active === false ? "Student reactivated." : "Student deactivated.", "success");
  }

  if (loadError && !summary) return <ErrorState text={loadError} onRetry={loadData} />;
  if (!summary) return <DashboardSkeleton />;

  return (
    <div className="page-stack">
      <section className="stats-grid">
        <StatCard label="Students" value={summary.stats.students} hint="Registered" tone="blue" />
        <StatCard label="Faculty" value={adminOverview?.totals.faculty ?? "—"} hint="Teaching staff" tone="green" />
        <StatCard label="Departments" value={adminOverview?.totals.departments ?? "—"} hint="Academic structure" tone="amber" />
        <StatCard label="Subjects" value={summary.stats.subjects} hint="Active" tone="amber" />
        <StatCard label="Classrooms" value={adminOverview?.totals.classrooms ?? "—"} hint="Managed rooms" tone="blue" />
        <StatCard label="Today's classes" value={adminOverview?.totals.todaysClasses ?? "—"} hint="Scheduled today" tone="green" />
        <StatCard label="Present marks" value={summary.stats.present} hint="All logs" tone="green" />
        <StatCard label="Absent marks" value={summary.stats.absent} hint={`${summary.stats.percentage}% present`} tone="red" />
      </section>

      {adminOverview && <section className="two-column"><div className="panel"><div className="section-heading"><div><span className="eyebrow">Operations</span><h2>Recent activity</h2></div><Badge value={`${adminOverview.recentActivity.length} recent`} /></div>{adminOverview.recentActivity.length ? <div className="list-stack">{adminOverview.recentActivity.map((item, index) => <div className="list-row" key={`${item.type}-${item.createdAt}-${index}`}><div><strong>{item.title}</strong><span>{item.type} · {new Date(item.createdAt).toLocaleString()}</span></div><Badge value="Logged" /></div>)}</div> : <p className="helper-text">No recent activity recorded.</p>}</div><div className="panel"><div className="section-heading"><div><span className="eyebrow">Security alerts</span><h2>Attention required</h2></div><Badge value="Monitor" /></div><div className="list-stack">{adminOverview.securityAlerts.map((alert) => <div className="list-row" key={alert.key}><div><strong>{alert.label}</strong><span>Review from the relevant management page.</span></div><Badge value={String(alert.count)} /></div>)}</div></div></section>}
      
      <section className="panel">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Oversight</span>
            <h2>Assignments Activity</h2>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <Badge value={`${assignments.length} Total`} />
            {assignments.filter(a => a.overdue).length > 0 && <Badge value={`${assignments.filter(a => a.overdue).length} Overdue`} />}
          </div>
        </div>
        {assignments.length > 0 ? (
          <div className="table-wrap compact-table">
            <table>
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Class</th>
                  <th>Teacher</th>
                  <th>Due Date</th>
                  <th>Completion</th>
                </tr>
              </thead>
              <tbody>
                {assignments.map(a => (
                  <tr key={a.id}>
                    <td><strong>{a.title}</strong></td>
                    <td>{a.className}</td>
                    <td>{a.teacherName}</td>
                    <td>
                      {a.dueDate} {a.overdue && <span style={{ marginLeft: "4px" }}><Badge value="overdue" /></span>}
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: '150px' }}>
                        <div style={{ flex: 1, background: 'var(--border)', height: '6px', borderRadius: '3px', overflow: 'hidden' }}>
                          <div style={{ background: 'var(--primary)', height: '100%', width: `${a.completionRate}%` }} />
                        </div>
                        <span style={{ fontSize: '0.85rem' }}>{a.completionRate}% ({a.completedCount}/{a.totalStudentsInClass})</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="helper-text">No assignments tracking data available.</p>
        )}
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Admin approval</span>
            <h2>Student ID requests</h2>
          </div>
          <Badge value={`${pendingRequests.length} Pending`} />
        </div>
        {pendingRequests.length ? (
          <div className="request-list">
            {pendingRequests.map((request) => (
              <div className="request-row" key={request.id}>
                <div>
                  <strong>{request.name}</strong>
                  <span>{request.rollNumber} · {request.className} · Graduation {request.graduationYear}</span>
                  <span>{request.email}</span>
                </div>
                <div className="action-row">
                  <button className="primary-button" type="button" onClick={() => approveStudentRequest(request.id)}>
                    Approve
                  </button>
                  <button className="secondary-button" type="button" onClick={() => rejectStudentRequest(request.id)}>
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="helper-text">No pending student ID requests.</p>
        )}
      </section>
      <section className="two-column wide-left">
        <div className="panel">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Students</span>
              <h2>Add, search, and manage</h2>
            </div>
            <button className="primary-button" type="button" onClick={() => { setEditingStudentId(""); setForm(blankStudent); setShowStudentModal(true); }}><Plus size={17} /> Add student</button>
          </div>
          <Modal open={showStudentModal} onClose={() => { setShowStudentModal(false); setEditingStudentId(""); setForm(blankStudent); }} title={editingStudentId ? "Edit student" : "Add a student"} description="Keep student records accurate and up to date." wide>
          <form className="admin-form" onSubmit={saveStudent}>
            {["name", "rollNumber", "className", "department", "email", "graduationYear"].map((field) => (
              <label key={field}>
                {studentLabels[field]}
                <input
                  placeholder={studentLabels[field]}
                  value={form[field]}
                  onChange={(e) => setForm({ ...form, [field]: e.target.value })}
                  required={["name", "rollNumber", "className", "department", "email"].includes(field)}
                />
              </label>
            ))}
            <button className="primary-button" type="submit">
              {editingStudentId ? <Save size={17} /> : <Plus size={17} />}
              {editingStudentId ? "Update student" : "Add student"}
            </button>
            {editingStudentId && (
              <button className="secondary-button" type="button" onClick={() => { setEditingStudentId(""); setForm(blankStudent); setShowStudentModal(false); }}>
                <X size={17} />
                Cancel edit
              </button>
            )}
          </form>
          </Modal>
          <label className="search-field full-width">
            <Search size={17} />
            <input placeholder="Search students" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <label>Status<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">All statuses</option><option value="approved">Active approved</option><option value="pending">Pending</option><option value="rejected">Rejected</option><option value="inactive">Inactive</option></select></label>
          <div className="table-wrap compact-table">
            <table>
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Class</th>
                  <th>Attendance</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filteredStudents.map((student) => (
                  <tr key={student.id}>
                    <td>{student.name}<span>{student.rollNumber}</span></td>
                    <td>{student.className}<span>{student.department}</span></td>
                    <td><Badge value={`${student.attendancePercentage}%`} /></td>
                    <td><Badge value={student.approvalStatus || "approved"} /></td>
                    <td>
                      <button className="icon-button" onClick={() => editStudent(student)} title="Edit student">
                        <Edit3 size={16} />
                      </button>
                      <button className="secondary-button" type="button" onClick={() => toggleStudent(student)}>{student.active === false ? "Activate" : "Deactivate"}</button>
                      <button className="icon-button danger" onClick={() => deleteStudent(student.id)} title="Delete student">
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}
