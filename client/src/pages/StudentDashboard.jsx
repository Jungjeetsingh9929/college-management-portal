import React, { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, Bell, BookOpen, Calendar, CalendarCheck, CheckCircle2, Clock3, FileText, GraduationCap, IndianRupee, Megaphone, ShieldCheck, XCircle } from "lucide-react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Link, useNavigate } from "react-router-dom";
import { Badge, DashboardSkeleton, EmptyState, ErrorState, ProgressBar, StatCard } from "../components/UI.jsx";
import { apiFetch } from "../context/api.js";
import { useAuth } from "../context/AuthContext.jsx";
import { sortAssignmentsByUrgency } from "../utils/assignments.js";
import { getUpcomingHolidays } from "../utils/dates.js";
import { StudentRecords } from "./StudentRecords.jsx";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const timeToMinutes = (value) => { const [hours, minutes] = String(value || "00:00").split(":").map(Number); return hours * 60 + minutes; };

export function StudentDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [portal, setPortal] = useState(null);
  const [error, setError] = useState("");

  async function loadPortal() {
    try { setError(""); setPortal(await apiFetch("/shared/student/portal")); } catch (err) { setError(err.message || "Unable to load your student portal."); }
  }
  useEffect(() => { loadPortal(); }, []);

  const scheduleToday = useMemo(() => {
    if (!portal) return [];
    const today = DAY_NAMES[new Date().getDay()];
    return portal.schedule.filter((item) => item.day === today).sort((a, b) => a.period - b.period);
  }, [portal]);
  const activeClassIndex = scheduleToday.findIndex((item) => {
    const now = new Date().getHours() * 60 + new Date().getMinutes();
    return now >= timeToMinutes(item.startTime) && now <= timeToMinutes(item.endTime);
  });
  const nextClass = scheduleToday.find((item) => timeToMinutes(item.startTime) > new Date().getHours() * 60 + new Date().getMinutes());
  const pendingAssignments = portal?.assignments.filter((item) => !item.completed) || [];
  const upcomingExams = (portal?.examinations || []).slice(0, 3);
  const notices = portal?.notices || [];
  const holidays = getUpcomingHolidays(portal?.holidays || [], 14);
  const isLow = portal?.attendance?.stats?.percentage < 75 && portal?.attendance?.stats?.total > 0;

  if (error && !portal) return <ErrorState text={error} onRetry={loadPortal} />;
  if (!portal) return <DashboardSkeleton />;

  return (
    <div className="page-stack student-dashboard">
      <section className="welcome-banner">
        <div><span className="eyebrow">Student overview</span><h2>Good {new Date().getHours() < 12 ? "morning" : "afternoon"}, {user?.name?.split(" ")[0]}.</h2><p>Stay ahead of classes, attendance, assignments, and campus updates.</p></div>
        <div className="welcome-orb"><GraduationCap size={34} /></div>
      </section>
      {isLow && <div className="warning-banner"><AlertTriangle size={18} /> Attendance is below 75%. Connect with your class teacher before the next review.</div>}
      {holidays.length > 0 && <div className="success-box"><Calendar size={18} /><div><strong>Coming up:</strong> {holidays.map((item) => `${item.title} (${item.date})`).join(", ")}</div></div>}

      <section className="stats-grid">
        <StatCard label="Overall attendance" value={`${portal.attendance.stats.percentage}%`} hint="Across all subjects" tone="blue" icon={CalendarCheck} />
        <StatCard label="Classes present" value={portal.attendance.stats.present} hint={`${portal.attendance.stats.total} marked classes`} tone="green" icon={CheckCircle2} />
        <StatCard label="Pending assignments" value={pendingAssignments.length} hint="Keep your deadlines clear" tone="amber" icon={FileText} />
        <StatCard label="Fee status" value={portal.fees.status === "not-published" ? "N/A" : portal.fees.status} hint={portal.fees.dueDate ? `Due ${portal.fees.dueDate}` : "No fee notice published"} tone="red" icon={IndianRupee} />
      </section>

      <section className="quick-actions panel">
        <div className="section-heading"><div><span className="eyebrow">Shortcuts</span><h2>Quick actions</h2></div><ShieldCheck size={19} /></div>
        <div className="quick-action-grid"><Link to="/schedule" className="quick-action"><Calendar size={18} /><span>View timetable</span><ArrowRight size={15} /></Link><Link to="/history" className="quick-action"><CalendarCheck size={18} /><span>Attendance history</span><ArrowRight size={15} /></Link><Link to="/assignments" className="quick-action"><FileText size={18} /><span>My assignments</span><ArrowRight size={15} /></Link><Link to="/complaints" className="quick-action"><Megaphone size={18} /><span>Contact administration</span><ArrowRight size={15} /></Link></div>
      </section>

      <section className="two-column student-main-grid">
        <div className="panel">
          <div className="section-heading"><div><span className="eyebrow">Today · {DAY_NAMES[new Date().getDay()]}</span><h2>Today's classes</h2></div><Link className="ghost-button" to="/schedule">Full timetable <ArrowRight size={15} /></Link></div>
          {scheduleToday.length ? <div className="class-list">{scheduleToday.map((item, index) => <div className={`class-card ${index === activeClassIndex ? "current-class" : index < activeClassIndex ? "completed-class" : ""}`} key={item.id}><div className="class-time"><strong>{item.startTime}</strong><span>{item.endTime}</span></div><div className="class-status-line" /><div className="class-copy"><strong>{item.subject}</strong><span>{item.teacher} · {item.room}</span><small>{item.activity || "Lecture"}</small></div><Badge value={index === activeClassIndex ? "Current" : index < activeClassIndex ? "Completed" : index === scheduleToday.findIndex((entry) => entry.id === nextClass?.id) ? "Next" : "Upcoming"} /></div>)}</div> : <EmptyState title="No classes scheduled today" text="Your complete weekly timetable will appear in the schedule view." />}
          {nextClass && <div className="next-class-callout"><Clock3 size={17} /><span><strong>Next class:</strong> {nextClass.subject} at {nextClass.startTime} in {nextClass.room}.</span></div>}
        </div>
        <div className="panel">
          <div className="section-heading"><div><span className="eyebrow">Academic pulse</span><h2>Attendance trend</h2></div><Badge value={isLow ? "Needs attention" : "On track"} /></div>
          <div className="chart-box"><ResponsiveContainer width="100%" height={220}><BarChart data={portal.attendance.subjects}><XAxis dataKey="code" /><YAxis domain={[0, 100]} hide /><Tooltip /><Bar dataKey="percentage" fill="#6869ed" radius={[6, 6, 0, 0]} /></BarChart></ResponsiveContainer></div>
          <div className="subject-mini-list">{portal.attendance.subjects.slice(0, 4).map((subject) => <div key={subject.subjectId}><span>{subject.code || subject.subjectName}</span><strong>{subject.percentage}%</strong></div>)}</div>
        </div>
      </section>

      <section className="student-information-grid">
        <div className="panel"><div className="section-heading"><div><span className="eyebrow">Deadlines</span><h2>Assignments</h2></div><Link className="ghost-button" to="/assignments">View all <ArrowRight size={15} /></Link></div>{pendingAssignments.length ? <div className="list-stack">{sortAssignmentsByUrgency(pendingAssignments).slice(0, 4).map((item) => <div className="list-row" key={item.id}><div><strong>{item.title}</strong><span>{item.subjectName || item.className} · Due {item.dueDate}</span></div><Badge value={item.status} /></div>)}</div> : <EmptyState title="You're all caught up" text="No pending assignment deadlines." />}</div>
        <div className="panel"><div className="section-heading"><div><span className="eyebrow">Examination</span><h2>Upcoming exams</h2></div><BookOpen size={18} /></div>{upcomingExams.length ? <div className="list-stack">{upcomingExams.map((exam) => <div className="list-row" key={exam.id || `${exam.subject}-${exam.date}`}><div><strong>{exam.subject}</strong><span>{exam.date} · {exam.time} · Room {exam.room}</span></div><Badge value="Upcoming" /></div>)}</div> : <EmptyState title="No exam schedule published" text="Your examination schedule and results will appear here when released." />}</div>
        <div className="panel"><div className="section-heading"><div><span className="eyebrow">Academics</span><h2>Performance</h2></div><GraduationCap size={18} /></div>{portal.academics.sgpa || portal.academics.cgpa || portal.academics.subjects?.length ? <div className="performance-summary"><div><span>SGPA</span><strong>{portal.academics.sgpa || "—"}</strong></div><div><span>CGPA</span><strong>{portal.academics.cgpa || "—"}</strong></div><div className="performance-subjects">{portal.academics.subjects.map((item) => <div key={item.subject || item.code}><span>{item.subject || item.code}</span><strong>{item.marks ?? "—"}</strong></div>)}</div></div> : <EmptyState title="Academic results not published" text="Internal marks, semester results, SGPA, and CGPA will appear here." />}</div>
        <div className="panel"><div className="section-heading"><div><span className="eyebrow">Campus feed</span><h2>Recent notices</h2></div><Bell size={18} /></div>{notices.length ? <div className="notice-list">{notices.map((notice) => <article key={notice.id || notice.title}><div className="notice-icon"><Megaphone size={16} /></div><div><strong>{notice.title}</strong><span>{notice.category || "College notice"} · {notice.date || notice.createdAt || "Recently"}</span><p>{notice.description || notice.body}</p></div></article>)}</div> : <EmptyState title="No recent notices" text="College, department, examination, event, and emergency announcements will appear here." />}</div>
      </section>

      <section className="panel read-only-note"><ShieldCheck size={18} /><div><strong>Attendance is read-only for students</strong><span>Only authorized faculty and administrators can mark attendance. Use the attendance history to review your records and raise a complaint if something looks incorrect.</span></div></section>
      <StudentRecords />
    </div>
  );
}
