import React, { useEffect, useMemo, useState } from "react";
import { ArrowRight, Bell, BookOpen, Calendar, CalendarCheck, ClipboardCheck, FileText, GraduationCap, Megaphone, UsersRound } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge, DashboardSkeleton, EmptyState, ErrorState, StatCard } from "../components/UI.jsx";
import { apiFetch } from "../context/api.js";
import { useAuth } from "../context/AuthContext.jsx";
import { getUpcomingHolidays } from "../utils/dates.js";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export function FacultyDashboard() {
  const { user } = useAuth();
  const [portal, setPortal] = useState(null);
  const [error, setError] = useState("");
  async function loadPortal() { try { setError(""); setPortal(await apiFetch("/faculty/portal")); } catch (err) { setError(err.message || "Unable to load faculty dashboard."); } }
  useEffect(() => { loadPortal(); }, []);
  const todayClasses = useMemo(() => portal?.schedule.filter((item) => item.day === DAYS[new Date().getDay()]).sort((a, b) => a.period - b.period) || [], [portal]);
  const overdue = portal?.assignments.filter((item) => new Date(item.dueDate) < new Date()).length || 0;
  const upcomingHolidays = getUpcomingHolidays(portal?.holidays || [], 7);
  if (error && !portal) return <ErrorState text={error} onRetry={loadPortal} />;
  if (!portal) return <DashboardSkeleton />;
  return (
    <div className="page-stack faculty-dashboard">
      <section className="welcome-banner"><div><span className="eyebrow">Faculty overview</span><h2>Welcome back, {user.name.split(" ")[0]}.</h2><p>Your teaching workspace is scoped to assigned classes, subjects, and students.</p></div><div className="welcome-orb"><GraduationCap size={34} /></div></section>
      {upcomingHolidays.length > 0 && <div className="success-box"><Calendar size={18} /><div><strong>Upcoming:</strong> {upcomingHolidays.map((h) => `${h.title} (${h.date})`).join(", ")}</div></div>}
      <section className="stats-grid"><StatCard label="Today's classes" value={todayClasses.length} hint="Assigned timetable" tone="blue" icon={CalendarCheck} /><StatCard label="Assigned subjects" value={portal.subjects.length} hint={portal.classes.join(" · ") || "No classes yet"} tone="green" icon={BookOpen} /><StatCard label="Students in scope" value={portal.students.length} hint="Your assigned classes" tone="amber" icon={UsersRound} /><StatCard label="Open assignments" value={portal.assignments.length} hint={overdue ? `${overdue} overdue` : "No overdue items"} tone="red" icon={FileText} /></section>
      <section className="quick-actions panel"><div className="section-heading"><div><span className="eyebrow">Teaching tools</span><h2>Quick actions</h2></div><ClipboardCheck size={19} /></div><div className="quick-action-grid"><Link to="/mark-attendance" className="quick-action"><ClipboardCheck size={18} /><span>Mark attendance</span><ArrowRight size={15} /></Link><Link to="/faculty/assignments" className="quick-action"><FileText size={18} /><span>Manage assignments</span><ArrowRight size={15} /></Link><Link to="/faculty/quiz-generate" className="quick-action"><CalendarCheck size={18} /><span>Create attendance quiz</span><ArrowRight size={15} /></Link><Link to="/schedule" className="quick-action"><Calendar size={18} /><span>Teaching timetable</span><ArrowRight size={15} /></Link><Link to="/faculty/tools" className="quick-action"><Megaphone size={18} /><span>Marks, notes & notices</span><ArrowRight size={15} /></Link></div></section>
      <section className="two-column"><div className="panel"><div className="section-heading"><div><span className="eyebrow">Today · {DAYS[new Date().getDay()]}</span><h2>Today's classes</h2></div><Link className="ghost-button" to="/schedule">Full timetable <ArrowRight size={15} /></Link></div>{todayClasses.length ? <div className="class-list">{todayClasses.map((item) => <div className="class-card" key={item.id}><div className="class-time"><strong>{item.startTime}</strong><span>{item.endTime}</span></div><div className="class-status-line" /><div className="class-copy"><strong>{item.subject}</strong><span>{item.section} · {item.room}</span><small>{item.activity || "Lecture"}</small></div><Badge value="Assigned" /></div>)}</div> : <EmptyState title="No classes today" text="Your assigned timetable is clear for today." />}</div><div className="panel"><div className="section-heading"><div><span className="eyebrow">Notifications</span><h2>Teaching updates</h2></div><Bell size={18} /></div><div className="notice-list">{overdue > 0 && <article><div className="notice-icon"><FileText size={16} /></div><div><strong>Assignment follow-up</strong><span>{overdue} overdue assignment{overdue > 1 ? "s" : ""}</span><p>Review submissions and update marks when ready.</p></div></article>}{portal.notices.length ? portal.notices.slice(0, 3).map((notice) => <article key={notice.id}><div className="notice-icon"><Megaphone size={16} /></div><div><strong>{notice.title}</strong><span>{notice.category}</span><p>{notice.body}</p></div></article>) : <EmptyState title="No new notices" text="Department and college notifications will appear here." />}</div></div></section>
      <section className="panel"><div className="section-heading"><div><span className="eyebrow">Student performance</span><h2>Students in your classes</h2></div><span className="helper-text">Read-only overview</span></div>{portal.students.length ? <div className="table-wrap"><table><thead><tr><th>Student</th><th>Class</th><th>Attendance</th><th>Status</th></tr></thead><tbody>{portal.students.slice(0, 12).map((student) => <tr key={student.id}><td><strong>{student.name}</strong><span>{student.rollNumber}</span></td><td>{student.className}</td><td><Badge value={`${student.attendance?.percentage || 0}%`} /></td><td><Badge value={student.approvalStatus || "approved"} /></td></tr>)}</tbody></table></div> : <EmptyState title="No assigned students" text="Students will appear after an administrator assigns your classes." />}</section>
      <section className="panel read-only-note"><UsersRound size={18} /><div><strong>Access is class-scoped</strong><span>You can only view students, schedules, assignments, notes, marks, and notices connected to your assigned classes and teacher code.</span></div></section>
    </div>
  );
}
