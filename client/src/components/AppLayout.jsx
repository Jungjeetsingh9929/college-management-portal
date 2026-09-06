import React from "react";
import { BarChart3, BookOpen, CalendarDays, ClipboardCheck, ClipboardList, GraduationCap, History, KeyRound, LayoutDashboard, LogOut, UserRound, UsersRound, Calendar, FileText, QrCode } from "lucide-react";
import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { QuizNotifications } from "./QuizNotifications.jsx";

export function AppLayout({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const adminLinks = [
    { to: "/admin", label: "Dashboard", icon: LayoutDashboard },
    { to: "/subjects", label: "Subjects", icon: BookOpen },
    { to: "/mark-attendance", label: "Mark Attendance", icon: ClipboardCheck },
    { to: "/schedule", label: "Schedule", icon: CalendarDays },
    { to: "/teachers", label: "Teachers", icon: UsersRound },
    { to: "/complaints", label: "Complaints", icon: ClipboardList },
    { to: "/history", label: "History", icon: History },
    { to: "/reports", label: "Reports", icon: BarChart3 },
    { to: "/year-schedule", label: "Year Schedule", icon: Calendar },
    { to: "/account", label: "Change Password", icon: KeyRound }
  ];
  const facultyLinks = [
    { to: "/faculty", label: "Dashboard", icon: LayoutDashboard },
    { to: "/faculty/assignments", label: "Assignments", icon: FileText },
    { to: "/mark-attendance", label: "Mark Attendance", icon: ClipboardCheck },
    { to: "/faculty/quiz-generate", label: "QR Attendance", icon: QrCode },
    { to: "/schedule", label: "Class Schedule", icon: CalendarDays },
    { to: "/year-schedule", label: "Year Schedule", icon: Calendar },
    { to: "/account", label: "Change Password", icon: KeyRound }
  ];
  const studentLinks = [
    { to: "/student", label: "Dashboard", icon: LayoutDashboard },
    { to: "/assignments", label: "Assignments", icon: FileText },
    { to: "/schedule", label: "Schedule", icon: CalendarDays },
    { to: "/teachers", label: "Teachers", icon: UsersRound },
    { to: "/complaints", label: "Complaints", icon: ClipboardList },
    { to: "/history", label: "History", icon: History },
    { to: "/profile", label: "Profile", icon: UserRound },
    { to: "/year-schedule", label: "Year Schedule", icon: Calendar },
    { to: "/account", label: "Change Password", icon: KeyRound }
  ];
  const links = user?.role === "admin" ? adminLinks : user?.role === "teacher" ? facultyLinks : studentLinks;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <GraduationCap size={23} />
          </div>
          <div>
            <strong>College Portal</strong>
            <span>Attendance + Complaints</span>
          </div>
        </div>
        <nav>
          {links.map((item) => (
            <NavLink key={item.to} to={item.to} className="nav-link">
              <item.icon size={18} />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <button
          className="ghost-button logout"
          onClick={() => {
            logout();
            navigate("/");
          }}
        >
          <LogOut size={18} />
          Sign out
        </button>
      </aside>
      <main className="main-area">
        <header className="topbar">
          <div>
            <span className="eyebrow">{user?.role === "admin" ? "Admin panel" : user?.role === "teacher" ? "Faculty panel" : "Student panel"}</span>
            <h1>{user?.name}</h1>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <QuizNotifications />
            <div className="user-pill">{user?.role}</div>
          </div>
        </header>
        {children}
      </main>
    </div>
  );
}
