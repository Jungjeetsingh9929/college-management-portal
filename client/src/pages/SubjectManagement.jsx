import React, { useEffect, useState } from "react";
import { CalendarPlus, Edit3, Plus, Save, Trash2, X } from "lucide-react";
import { apiFetch } from "../context/api.js";

const blankSubject = {
  subjectName: "",
  code: "",
  teacher: "",
  className: "CSE 3A",
  schedule: "",
  room: ""
};

const blankClass = {
  subjectId: "",
  className: "CSE 3A",
  day: "Monday",
  startTime: "09:00",
  endTime: "10:00",
  room: ""
};

const subjectLabels = {
  subjectName: "Subject Name",
  code: "Subject Code",
  teacher: "Professor Name",
  className: "Class / Section",
  schedule: "Schedule Text",
  room: "Room No."
};

const classLabels = {
  className: "Class / Section",
  day: "Day",
  startTime: "Start Time",
  endTime: "End Time",
  room: "Room No."
};

export function SubjectManagement() {
  const [subjects, setSubjects] = useState([]);
  const [classes, setClasses] = useState([]);
  const [subjectForm, setSubjectForm] = useState(blankSubject);
  const [editingSubjectId, setEditingSubjectId] = useState("");
  const [classForm, setClassForm] = useState(blankClass);
  const [editingClassId, setEditingClassId] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function loadData() {
    const data = await apiFetch("/subjects");
    setSubjects(data.subjects);
    setClasses(data.classes);
    if (!classForm.subjectId && data.subjects[0]) setClassForm((old) => ({ ...old, subjectId: data.subjects[0].id }));
  }

  useEffect(() => {
    loadData();
  }, []);

  async function saveSubject(event) {
    event.preventDefault();
    const wasEditing = Boolean(editingSubjectId);
    setMessage("");
    setError("");
    try {
      const path = wasEditing ? `/subjects/${editingSubjectId}` : "/subjects";
      await apiFetch(path, { method: wasEditing ? "PUT" : "POST", body: JSON.stringify(subjectForm) });
      setSubjectForm(blankSubject);
      setEditingSubjectId("");
      await loadData();
      setMessage(wasEditing ? "Subject updated successfully." : "Subject added successfully.");
    } catch (err) {
      setError(err.message);
    }
  }

  function editSubject(subject) {
    setEditingSubjectId(subject.id);
    setSubjectForm({
      subjectName: subject.subjectName,
      code: subject.code,
      teacher: subject.teacher,
      className: subject.className,
      schedule: subject.schedule || "",
      room: subject.room || ""
    });
  }

  async function deleteSubject(id) {
    setMessage("");
    setError("");
    try {
      await apiFetch(`/subjects/${id}`, { method: "DELETE" });
      await loadData();
      setMessage("Subject deleted successfully.");
    } catch (err) {
      setError(err.message);
    }
  }

  async function addClass(event) {
    event.preventDefault();
    const wasEditing = Boolean(editingClassId);
    setMessage("");
    setError("");
    try {
      const path = wasEditing ? `/subjects/classes/${editingClassId}` : "/subjects/classes";
      await apiFetch(path, { method: wasEditing ? "PUT" : "POST", body: JSON.stringify(classForm) });
      setClassForm({ ...blankClass, subjectId: classForm.subjectId });
      setEditingClassId("");
      await loadData();
      setMessage(wasEditing ? "Class timing updated successfully." : "Class timing added successfully.");
    } catch (err) {
      setError(err.message);
    }
  }

  function editClass(classItem) {
    setEditingClassId(classItem.id);
    setClassForm({
      subjectId: classItem.subjectId,
      className: classItem.className,
      day: classItem.day,
      startTime: classItem.startTime,
      endTime: classItem.endTime,
      room: classItem.room || ""
    });
  }

  function cancelClassEdit() {
    setEditingClassId("");
    setClassForm({ ...blankClass, subjectId: classForm.subjectId });
  }

  async function deleteClass(id) {
    setMessage("");
    setError("");
    try {
      await apiFetch(`/subjects/classes/${id}`, { method: "DELETE" });
      await loadData();
      setMessage("Class timing deleted successfully.");
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="page-stack">
      <section className="two-column">
        <div className="panel">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Subjects</span>
              <h2>Manage subjects</h2>
            </div>
          </div>
          <form className="admin-form" onSubmit={saveSubject}>
            {Object.keys(blankSubject).map((field) => (
              <label key={field}>
                {subjectLabels[field]}
                <input
                  placeholder={subjectLabels[field]}
                  value={subjectForm[field]}
                  onChange={(e) => setSubjectForm({ ...subjectForm, [field]: e.target.value })}
                  required={["subjectName", "code", "teacher", "className"].includes(field)}
                />
              </label>
            ))}
            <button className="primary-button" type="submit">
              {editingSubjectId ? <Save size={17} /> : <Plus size={17} />}
              {editingSubjectId ? "Update subject" : "Add subject"}
            </button>
            {editingSubjectId && (
              <button className="secondary-button" type="button" onClick={() => { setEditingSubjectId(""); setSubjectForm(blankSubject); }}>
                <X size={17} />
                Cancel edit
              </button>
            )}
          </form>
          {message && <div role="status" className="success-box">{message}</div>}
          {error && <div role="alert" className="error-box">{error}</div>}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Subject</th>
                  <th>Professor</th>
                  <th>Schedule</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {subjects.map((subject) => (
                  <tr key={subject.id}>
                    <td>{subject.subjectName}<span>{subject.code} · {subject.className}</span></td>
                    <td>{subject.teacher}</td>
                    <td>{subject.schedule || "-"}<span>{subject.room}</span></td>
                    <td>
                      <button className="icon-button" onClick={() => editSubject(subject)} title="Edit subject">
                        <Edit3 size={16} />
                      </button>
                      <button className="icon-button danger" onClick={() => deleteSubject(subject.id)} title="Delete subject">
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="panel">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Timetable</span>
              <h2>{editingClassId ? "Edit class timing" : "Add class timing"}</h2>
            </div>
            <CalendarPlus size={22} />
          </div>
          <form className="form-stack" onSubmit={addClass}>
            <label>
              Subject
              <select value={classForm.subjectId} onChange={(e) => setClassForm({ ...classForm, subjectId: e.target.value })}>
                {subjects.map((subject) => (
                  <option key={subject.id} value={subject.id}>{subject.subjectName}</option>
                ))}
              </select>
            </label>
            {["className", "day", "startTime", "endTime", "room"].map((field) => (
              <label key={field}>
                {classLabels[field]}
                <input
                  type={field.includes("Time") ? "time" : "text"}
                  value={classForm[field]}
                  onChange={(e) => setClassForm({ ...classForm, [field]: e.target.value })}
                />
              </label>
            ))}
            <button className="primary-button full" type="submit">
              {editingClassId ? "Update class timing" : "Add class timing"}
            </button>
            {editingClassId && (
              <button className="secondary-button full" type="button" onClick={cancelClassEdit}>
                Cancel edit
              </button>
            )}
          </form>
          <div className="list-stack timetable-list">
            {classes.map((classItem) => {
              const subject = subjects.find((item) => item.id === classItem.subjectId);
              return (
                <div className="list-row" key={classItem.id}>
                  <div>
                    <strong>{subject?.subjectName || "Subject"}</strong>
                    <span>{classItem.day} · {classItem.startTime}-{classItem.endTime} · {classItem.room}</span>
                  </div>
                  <div className="action-row">
                    <button className="icon-button" onClick={() => editClass(classItem)} title="Edit class timing">
                      <Edit3 size={16} />
                    </button>
                    <button className="icon-button danger" onClick={() => deleteClass(classItem.id)} title="Delete class">
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}
