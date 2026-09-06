import React, { useEffect, useMemo, useState } from "react";
import { CalendarDays, Edit3, Plus, Save, Trash2, X } from "lucide-react";
import { Badge, EmptyState, ProgressBar, StatCard } from "../components/UI.jsx";
import { apiFetch } from "../context/api.js";
import { useAuth } from "../context/AuthContext.jsx";

const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const periodTimes = [
  ["1", "09:30", "10:20"],
  ["2", "10:20", "11:10"],
  ["3", "11:10", "12:00"],
  ["4", "13:00", "13:50"],
  ["5", "13:50", "14:40"],
  ["6", "14:40", "15:30"],
  ["7", "15:30", "16:20"],
  ["8", "16:20", "17:00"]
];

const blankSchedule = {
  day: "Monday",
  section: "CSE 3A",
  room: "S302",
  period: 1,
  startTime: "09:30",
  endTime: "10:20",
  subject: "",
  teacher: "",
  activity: "Lecture",
  notes: ""
};

function applyPeriodTime(period, form) {
  const time = periodTimes.find(([item]) => Number(item) === Number(period));
  if (!time) return { ...form, period: Number(period) };
  return { ...form, period: Number(period), startTime: time[1], endTime: time[2] };
}

function normalizeText(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function Schedule() {
  const { user } = useAuth();
  const [schedules, setSchedules] = useState([]);
  const [sections, setSections] = useState([]);
  const [attendanceSummary, setAttendanceSummary] = useState(null);
  const [selectedSchedule, setSelectedSchedule] = useState(null);
  const [sectionFilter, setSectionFilter] = useState("");
  const [dayFilter, setDayFilter] = useState("");
  const [form, setForm] = useState(blankSchedule);
  const [editingId, setEditingId] = useState("");
  const [message, setMessage] = useState("");

  async function loadSchedules() {
    if (user.role === "teacher") {
      // Faculty only ever see the classes assigned to them, never the full timetable.
      const data = await apiFetch("/faculty/schedule");
      const ownSections = [...new Set(data.schedules.map((item) => item.section))].sort();
      setSchedules(data.schedules);
      setSections(ownSections);
      if (!sectionFilter && ownSections[0]) setSectionFilter(ownSections[0]);
      return;
    }
    const data = await apiFetch("/schedules");
    setSchedules(data.schedules);
    setSections(data.sections);
    if (!sectionFilter && user.role === "admin" && data.sections[0]) setSectionFilter(data.sections[0]);
    if (user.role === "student") {
      const summary = await apiFetch("/attendance/summary");
      setAttendanceSummary(summary);
    }
  }

  useEffect(() => {
    loadSchedules();
  }, []);

  const visibleSchedules = useMemo(() => {
    return schedules
      .filter((item) => !sectionFilter || item.section === sectionFilter)
      .filter((item) => !dayFilter || item.day === dayFilter)
      .sort((a, b) => days.indexOf(a.day) - days.indexOf(b.day) || a.period - b.period);
  }, [schedules, sectionFilter, dayFilter]);

  // Admins pick from every section in the college; teachers only ever pick among
  // the sections their own `/faculty/schedule` classes cover; students are locked
  // to their own class.
  const activeSections = user.role === "student" ? [user.className] : sections;
  const selectedSection = user.role === "student" ? user.className : sectionFilter || sections[0] || "";
  const tableSchedules = schedules.filter((item) => item.section === selectedSection);
  const selectedAttendance = useMemo(() => {
    if (!selectedSchedule || !attendanceSummary) return null;
    const subjectKey = normalizeText(selectedSchedule.subject);
    const teacherKey = normalizeText(selectedSchedule.teacher);
    const match = attendanceSummary.subjects.find((subject) => {
      const codeMatch = normalizeText(subject.code) === subjectKey;
      const nameMatch = normalizeText(subject.subjectName) === subjectKey;
      const teacherMatch = normalizeText(subject.teacher).includes(teacherKey);
      return codeMatch || nameMatch || teacherMatch;
    });
    return match || { subjectName: selectedSchedule.subject, code: selectedSchedule.subject, teacher: selectedSchedule.teacher, total: 0, present: 0, absent: 0, percentage: 0 };
  }, [attendanceSummary, selectedSchedule]);

  async function saveSchedule(event) {
    event.preventDefault();
    setMessage("");
    try {
      const path = editingId ? `/schedules/${editingId}` : "/schedules";
      const data = await apiFetch(path, { method: editingId ? "PUT" : "POST", body: JSON.stringify(form) });
      setMessage(editingId ? "Schedule updated." : "Schedule added.");
      setEditingId("");
      setForm(applyPeriodTime(1, blankSchedule));
      loadSchedules();
      return data;
    } catch (error) {
      setMessage(error.message);
      return null;
    }
  }

  function editSchedule(item) {
    setEditingId(item.id);
    setForm({
      day: item.day,
      section: item.section,
      room: item.room,
      period: item.period,
      startTime: item.startTime,
      endTime: item.endTime,
      subject: item.subject,
      teacher: item.teacher,
      activity: item.activity || "Lecture",
      notes: item.notes || ""
    });
  }

  async function deleteSchedule(id) {
    if (!window.confirm("Delete this timetable entry?")) return;
    setMessage("");
    try {
      await apiFetch(`/schedules/${id}`, { method: "DELETE" });
      await loadSchedules();
      setMessage("Schedule deleted successfully.");
    } catch (error) {
      setMessage(error.message);
    }
  }

  return (
    <div className="page-stack">
      <section className="panel">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Class timetable</span>
            <h2>
              {user.role === "admin"
                ? "Section-wise schedule control"
                : user.role === "teacher"
                ? "Your teaching schedule"
                : `${user.className} schedule`}
            </h2>
          </div>
          <CalendarDays size={22} />
        </div>
        {user.role === "teacher" && sections.length === 0 && (
          <p className="helper-text">No classes have been assigned to you yet. Once an admin adds you as the teacher on a schedule entry, it will show up here.</p>
        )}
        <div className="toolbar">
          {(user.role === "admin" || user.role === "teacher") && sections.length > 0 && (
            <label>
              Section
              <select value={sectionFilter || sections[0] || ""} onChange={(event) => setSectionFilter(event.target.value)}>
                {activeSections.map((section) => <option key={section} value={section}>{section}</option>)}
              </select>
            </label>
          )}
          <label>
            Day
            <select value={dayFilter} onChange={(event) => setDayFilter(event.target.value)}>
              <option value="">All days</option>
              {days.map((day) => <option key={day} value={day}>{day}</option>)}
            </select>
          </label>
        </div>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Time table view</span>
            <h2>{selectedSection || "Section"} weekly table</h2>
          </div>
          <Badge value="Lunch 12:00-1:00" />
        </div>
        <div className="table-wrap schedule-table-wrap">
          <table className="schedule-table">
            <thead>
              <tr>
                <th>Day</th>
                {periodTimes.slice(0, 3).map(([period, start, end]) => (
                  <th key={period}>{period}<span>{start}-{end}</span></th>
                ))}
                <th className="lunch-col">Lunch</th>
                {periodTimes.slice(3).map(([period, start, end]) => (
                  <th key={period}>{period}<span>{start}-{end}</span></th>
                ))}
              </tr>
            </thead>
            <tbody>
              {days.map((day) => (
                <tr key={day}>
                  <td><strong>{day}</strong></td>
                  {periodTimes.slice(0, 3).map(([period]) => {
                    const item = tableSchedules.find((entry) => entry.day === day && entry.period === Number(period));
                    return <ScheduleCell item={item} key={`${day}-${period}`} onSelect={user.role === "student" ? setSelectedSchedule : null} selected={selectedSchedule?.id === item?.id} />;
                  })}
                  <td className="lunch-col">LUNCH</td>
                  {periodTimes.slice(3).map(([period]) => {
                    const item = tableSchedules.find((entry) => entry.day === day && entry.period === Number(period));
                    return <ScheduleCell item={item} key={`${day}-${period}`} onSelect={user.role === "student" ? setSelectedSchedule : null} selected={selectedSchedule?.id === item?.id} />;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {user.role === "student" && selectedSchedule && selectedAttendance && (
        <section className="panel teacher-attendance-panel">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Teacher attendance</span>
              <h2>{selectedSchedule.teacher} · {selectedSchedule.subject}</h2>
            </div>
            <Badge value={selectedAttendance.total ? `${selectedAttendance.percentage}%` : "No records"} />
          </div>
          {selectedAttendance.total ? (
            <>
              <section className="stats-grid compact-stats">
                <StatCard label="Present" value={selectedAttendance.present} hint="Marked present" tone="green" />
                <StatCard label="Absent" value={selectedAttendance.absent} hint="Marked absent" tone="red" />
                <StatCard label="Total" value={selectedAttendance.total} hint="Classes marked" tone="blue" />
                <StatCard label="Percentage" value={`${selectedAttendance.percentage}%`} hint={selectedAttendance.subjectName} tone="amber" />
              </section>
              <ProgressBar value={selectedAttendance.percentage} />
            </>
          ) : (
            <EmptyState
              title="No attendance marked for this teacher yet"
              text="Attendance for this subject will appear here once it has been marked by an admin or student."
            />
          )}
        </section>
      )}

      {user.role === "admin" && (
        <section className="two-column wide-left">
          <div className="panel">
            <div className="section-heading">
              <div>
                <span className="eyebrow">Admin control</span>
                <h2>{editingId ? "Edit schedule" : "Add schedule item"}</h2>
              </div>
            </div>
            <form className="admin-form" onSubmit={saveSchedule}>
              <label>
                Day
                <select value={form.day} onChange={(event) => setForm({ ...form, day: event.target.value })}>
                  {days.map((day) => <option key={day} value={day}>{day}</option>)}
                </select>
              </label>
              <label>
                Section
                <input value={form.section} onChange={(event) => setForm({ ...form, section: event.target.value })} required />
              </label>
              <label>
                Room
                <input value={form.room} onChange={(event) => setForm({ ...form, room: event.target.value })} required />
              </label>
              <label>
                Period
                <select value={form.period} onChange={(event) => setForm(applyPeriodTime(event.target.value, form))}>
                  {periodTimes.map(([period, start, end]) => (
                    <option value={period} key={period}>{period} ({start}-{end})</option>
                  ))}
                </select>
              </label>
              <label>
                Subject
                <input value={form.subject} onChange={(event) => setForm({ ...form, subject: event.target.value })} required />
              </label>
              <label>
                Teacher
                <input value={form.teacher} onChange={(event) => setForm({ ...form, teacher: event.target.value })} required />
              </label>
              <label>
                Start Time
                <input type="time" value={form.startTime} onChange={(event) => setForm({ ...form, startTime: event.target.value })} required />
              </label>
              <label>
                End Time
                <input type="time" value={form.endTime} onChange={(event) => setForm({ ...form, endTime: event.target.value })} required />
              </label>
              <label>
                Activity
                <select value={form.activity} onChange={(event) => setForm({ ...form, activity: event.target.value })}>
                  {["Lecture", "Lab", "Project", "Activity", "Mentoring", "Competition"].map((item) => <option key={item}>{item}</option>)}
                </select>
              </label>
              <label>
                Notes
                <input value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
              </label>
              <button className="primary-button" type="submit">
                {editingId ? <Save size={17} /> : <Plus size={17} />}
                {editingId ? "Update schedule" : "Add schedule"}
              </button>
              {editingId && (
                <button className="secondary-button" type="button" onClick={() => { setEditingId(""); setForm(blankSchedule); }}>
                  <X size={17} />
                  Cancel edit
                </button>
              )}
            </form>
            {message && <div className={message.includes("required") ? "error-box" : "success-box"}>{message}</div>}
          </div>

          <div className="panel">
            <div className="section-heading">
              <div>
                <span className="eyebrow">Entries</span>
                <h2>Manage current list</h2>
              </div>
            </div>
            {visibleSchedules.length ? (
              <div className="list-stack schedule-entry-list">
                {visibleSchedules.map((item) => (
                  <div className="list-row" key={item.id}>
                    <div>
                      <strong>{item.day} · Period {item.period}</strong>
                      <span>{item.section} · {item.subject} · {item.teacher}</span>
                      <span>{item.startTime}-{item.endTime} · {item.room}</span>
                    </div>
                    <div className="action-row">
                      <button className="icon-button" type="button" onClick={() => editSchedule(item)} title="Edit schedule">
                        <Edit3 size={16} />
                      </button>
                      <button className="icon-button danger" type="button" onClick={() => deleteSchedule(item.id)} title="Delete schedule">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title="No schedule entries" text="Add a class timing from the admin form." />
            )}
          </div>
        </section>
      )}
    </div>
  );
}

function ScheduleCell({ item, onSelect, selected }) {
  if (!item) return <td className="empty-schedule">-</td>;
  return (
    <td className={`schedule-cell ${item.activity?.toLowerCase() || "lecture"} ${selected ? "selected" : ""}`}>
      <button className="schedule-cell-button" type="button" onClick={() => onSelect?.(item)} disabled={!onSelect}>
        <strong>{item.subject}</strong>
        <span>{item.teacher}</span>
        <small>{item.room}</small>
        {item.notes && <small>{item.notes}</small>}
      </button>
    </td>
  );
}
