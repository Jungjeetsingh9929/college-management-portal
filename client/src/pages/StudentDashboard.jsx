import React, { useEffect, useState } from "react";
import { AlertTriangle, Calendar, CalendarCheck, CheckCircle2, Save, XCircle } from "lucide-react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Link, useNavigate } from "react-router-dom";
import { Badge, EmptyState, ProgressBar, StatCard } from "../components/UI.jsx";
import { AttendanceCheckin } from "../components/AttendanceCheckin.jsx";
import { apiFetch } from "../context/api.js";
import { useAuth } from "../context/AuthContext.jsx";
import { sortAssignmentsByUrgency } from "../utils/assignments.js";
import { getUpcomingHolidays } from "../utils/dates.js";

export function StudentDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [summary, setSummary] = useState(null);
  const [subjects, setSubjects] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [holidays, setHolidays] = useState([]);
  const lowThreshold = 75;

  async function loadData() {
    const [summaryData, subjectData, assignmentData, holidayData] = await Promise.all([
      apiFetch("/attendance/summary"),
      apiFetch("/subjects"),
      apiFetch("/shared/student/assignments"),
      apiFetch("/shared/holidays")
    ]);
    setSummary(summaryData);
    setSubjects(subjectData.subjects);
    if (assignmentData && assignmentData.assignments) {
      setAssignments(assignmentData.assignments);
    }
    if (holidayData && holidayData.holidays) {
      setHolidays(holidayData.holidays);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  if (!summary) return <div className="panel">Loading dashboard...</div>;
  const isLow = summary.stats.percentage < lowThreshold && summary.stats.total > 0;

  const pendingAssignments = assignments.filter((a) => !a.completed);
  const urgentCount = pendingAssignments.filter((a) => a.status === "overdue" || a.status === "due-soon").length;
  const topAssignments = sortAssignmentsByUrgency(pendingAssignments).slice(0, 3);
  const upcomingHolidays = getUpcomingHolidays(holidays, 7);

  return (
    <div className="page-stack">
      {isLow && (
        <div className="warning-banner">
          <AlertTriangle size={18} />
          Attendance is below {lowThreshold}%. Please connect with your class teacher.
        </div>
      )}
      {urgentCount > 0 && (
        <div className="warning-banner" style={{ cursor: "pointer" }} onClick={() => navigate("/assignments")}>
          <AlertTriangle size={18} />
          You have {urgentCount} assignment{urgentCount > 1 ? "s" : ""} due soon.
        </div>
      )}
      {upcomingHolidays.length > 0 && (
        <div className="success-box">
          <Calendar size={18} />
          <div>
            <strong>Upcoming:</strong>{" "}
            {upcomingHolidays.map((h) => `${h.title} (${h.date})`).join(", ")}
          </div>
        </div>
      )}
      <AttendanceCheckin onMarked={loadData} />
      <section className="stats-grid">
        <StatCard label="Overall percentage" value={`${summary.stats.percentage}%`} hint="All subjects" tone="blue" />
        <StatCard label="Present" value={summary.stats.present} hint="Marked present" tone="green" />
        <StatCard label="Absent" value={summary.stats.absent} hint="Marked absent" tone="red" />
        <StatCard label="Total classes" value={summary.stats.total} hint={user.rollNumber} tone="amber" />
      </section>
      <section className="two-column">
        <div className="panel">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Subject-wise</span>
              <h2>Attendance percentage</h2>
            </div>
          </div>
          <div className="chart-box">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={summary.subjects}>
                <XAxis dataKey="code" />
                <YAxis domain={[0, 100]} />
                <Tooltip />
                <Bar dataKey="percentage" fill="#2563eb" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="panel">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Today</span>
              <h2>Attendance status</h2>
            </div>
            <CalendarCheck size={22} />
          </div>
          {summary.today.length ? (
            <div className="list-stack">
              {summary.today.map((item) => (
                <div className="list-row" key={item.id}>
                  <div>
                    <strong>{item.subjectName}</strong>
                    <span>{item.time} · {item.method}</span>
                  </div>
                  <Badge value={item.status} />
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="No attendance marked today" text="Your daily status will appear here after class." />
          )}
        </div>
        <div className="panel">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Tasks</span>
              <h2>Pending Assignments</h2>
            </div>
            <Link to="/assignments" className="ghost-button">View all</Link>
          </div>
          {topAssignments.length ? (
            <div className="list-stack">
              {topAssignments.map((item) => (
                <div className="list-row" key={item.id} style={{ alignItems: 'flex-start' }}>
                  <div>
                    <strong>{item.title}</strong>
                    <span>Due: {item.dueDate} · {item.teacherName}</span>
                    <p style={{ margin: '4px 0 0', fontSize: '0.9rem', color: '#666' }}>{item.description}</p>
                  </div>
                  <Badge value={item.status} />
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="No pending assignments" text="You're all caught up!" />
          )}
        </div>
      </section>
      <section className="panel">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Subjects</span>
            <h2>Progress by subject</h2>
          </div>
        </div>
        <div className="subject-progress">
          {summary.subjects.map((subject) => (
            <article key={subject.subjectId}>
              <div>
                <strong>{subject.subjectName}</strong>
                <span>{subject.code} · {subject.teacher}</span>
              </div>
              <ProgressBar value={subject.percentage} />
              <div className="tiny-stats">
                <span><CheckCircle2 size={14} /> {subject.present}</span>
                <span><XCircle size={14} /> {subject.absent}</span>
                <strong>{subject.percentage}%</strong>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
