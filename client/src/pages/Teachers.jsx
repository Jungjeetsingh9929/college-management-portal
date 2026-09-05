import React, { useEffect, useMemo, useState } from "react";
import { Edit3, Plus, Save, Trash2, UserRound, X } from "lucide-react";
import { Badge, EmptyState, StatCard } from "../components/UI.jsx";
import { apiFetch } from "../context/api.js";
import { useAuth } from "../context/AuthContext.jsx";

const blankTeacher = {
  code: "",
  name: "",
  department: "Computer Science",
  email: "",
  password: "",
  phone: "",
  cabin: "",
  subjectsText: ""
};

export function Teachers() {
  const { user } = useAuth();
  const [teachers, setTeachers] = useState([]);
  const [query, setQuery] = useState("");
  const [form, setForm] = useState(blankTeacher);
  const [editingId, setEditingId] = useState("");
  const [message, setMessage] = useState("");

  async function loadTeachers() {
    const data = await apiFetch("/teachers");
    setTeachers(data.teachers);
  }

  useEffect(() => {
    loadTeachers();
  }, []);

  const filteredTeachers = useMemo(() => {
    const search = query.toLowerCase();
    return teachers.filter((teacher) =>
      [teacher.code, teacher.name, teacher.department, teacher.email, ...(teacher.subjects || [])]
        .join(" ")
        .toLowerCase()
        .includes(search)
    );
  }, [teachers, query]);

  async function saveTeacher(event) {
    event.preventDefault();
    setMessage("");
    const body = {
      code: form.code,
      name: form.name,
      department: form.department,
      email: form.email,
      ...(form.password ? { password: form.password } : {}),
      phone: form.phone,
      cabin: form.cabin,
      subjects: form.subjectsText.split(",").map((item) => item.trim()).filter(Boolean)
    };
    try {
      const path = editingId ? `/teachers/${editingId}` : "/teachers";
      await apiFetch(path, { method: editingId ? "PUT" : "POST", body: JSON.stringify(body) });
      setMessage(editingId ? "Teacher updated." : "Teacher added.");
      setEditingId("");
      setForm(blankTeacher);
      loadTeachers();
    } catch (error) {
      setMessage(error.message);
    }
  }

  function editTeacher(teacher) {
    setEditingId(teacher.id);
    setForm({
      code: teacher.code,
      name: teacher.name,
      department: teacher.department,
      email: teacher.email || "",
      password: "",
      phone: teacher.phone || "",
      cabin: teacher.cabin || "",
      subjectsText: (teacher.subjects || []).join(", ")
    });
  }

  async function deleteTeacher(id) {
    await apiFetch(`/teachers/${id}`, { method: "DELETE" });
    setMessage("Teacher deleted.");
    loadTeachers();
  }

  const departments = new Set(teachers.map((teacher) => teacher.department));

  return (
    <div className="page-stack">
      <section className="stats-grid">
        <StatCard label="Teachers" value={teachers.length} hint="Schedule faculty" tone="blue" />
        <StatCard label="Departments" value={departments.size} hint="Faculty groups" tone="green" />
        <StatCard label="Subjects mapped" value={teachers.reduce((sum, teacher) => sum + (teacher.subjects?.length || 0), 0)} hint="From timetable" tone="amber" />
      </section>

      {user.role === "admin" && (
        <section className="panel">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Admin control</span>
              <h2>{editingId ? "Edit teacher" : "Add teacher"}</h2>
            </div>
            <UserRound size={22} />
          </div>
          <form className="admin-form" onSubmit={saveTeacher}>
            <label>
              Teacher Code
              <input value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value.toUpperCase() })} required />
            </label>
            <label>
              Teacher Name
              <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
            </label>
            <label>
              Department
              <input value={form.department} onChange={(event) => setForm({ ...form, department: event.target.value })} required />
            </label>
            <label>
              Email
              <input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} required />
            </label>
            <label>
              {editingId ? "New password (optional)" : "Password"}
              <input type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} minLength={8} required={!editingId} />
            </label>
            <label>
              Phone
              <input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} />
            </label>
            <label>
              Cabin
              <input value={form.cabin} onChange={(event) => setForm({ ...form, cabin: event.target.value })} />
            </label>
            <label className="span-two">
              Subjects
              <input value={form.subjectsText} onChange={(event) => setForm({ ...form, subjectsText: event.target.value })} placeholder="PCCCS301, HSMC302" />
            </label>
            <button className="primary-button" type="submit">
              {editingId ? <Save size={17} /> : <Plus size={17} />}
              {editingId ? "Update teacher" : "Add teacher"}
            </button>
            {editingId && (
              <button className="secondary-button" type="button" onClick={() => { setEditingId(""); setForm(blankTeacher); }}>
                <X size={17} />
                Cancel edit
              </button>
            )}
          </form>
          {message && <div className={message.includes("required") || message.includes("exists") ? "error-box" : "success-box"}>{message}</div>}
        </section>
      )}

      <section className="panel">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Teachers</span>
            <h2>Faculty list from schedule</h2>
          </div>
        </div>
        <label className="search-field full-width">
          <input placeholder="Search teacher, code, department, or subject" value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
        {filteredTeachers.length ? (
          <div className="teacher-grid">
            {filteredTeachers.map((teacher) => (
              <article className="teacher-card" key={teacher.id}>
                <div className="teacher-card-head">
                  <div>
                    <strong>{teacher.name}</strong>
                    <span>{teacher.code} · {teacher.department}</span>
                  </div>
                  <Badge value={teacher.code} />
                </div>
                <div className="detail-list compact-details">
                  <div><span>Email</span><strong>{teacher.email || "-"}</strong></div>
                  <div><span>Cabin</span><strong>{teacher.cabin || "-"}</strong></div>
                </div>
                <div className="subject-tags">
                  {(teacher.subjects || []).slice(0, 6).map((subject) => <span key={subject}>{subject}</span>)}
                </div>
                {user.role === "admin" && (
                  <div className="action-row">
                    <button className="secondary-button" type="button" onClick={() => editTeacher(teacher)}>
                      <Edit3 size={16} />
                      Edit
                    </button>
                    <button className="secondary-button danger-text" type="button" onClick={() => deleteTeacher(teacher.id)}>
                      <Trash2 size={16} />
                      Delete
                    </button>
                  </div>
                )}
              </article>
            ))}
          </div>
        ) : (
          <EmptyState title="No teachers found" text="Teachers from the schedule will appear here." />
        )}
      </section>
    </div>
  );
}
