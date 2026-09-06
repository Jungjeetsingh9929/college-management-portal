import React, { useState } from "react";
import { BarChart3, Bell, BookOpen, Building2, CalendarDays, ClipboardCheck, ClipboardList, GraduationCap, History, KeyRound, LayoutDashboard, LogOut, Menu, ShieldCheck, UserRound, UsersRound, Calendar, FileText, QrCode, X } from "lucide-react";
import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { GlobalSearch } from "./GlobalSearch.jsx";
import { NotificationCenter } from "./NotificationCenter.jsx";
import { useToast } from "./UI.jsx";

export function AppLayout({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { showToast } = useToast() || {};
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const linksByRole = {
    admin: [
      { to: "/admin", label: "Dashboard", icon: LayoutDashboard }, { to: "/subjects", label: "Subjects", icon: BookOpen },
      { to: "/mark-attendance", label: "Mark Attendance", icon: ClipboardCheck }, { to: "/central-timetable", label: "Central Timetable", icon: CalendarDays }, { to: "/schedule", label: "Schedule", icon: CalendarDays },
      { to: "/teachers", label: "Teachers", icon: UsersRound }, { to: "/admin/resources", label: "Departments & Rooms", icon: Building2 }, { to: "/admin/security", label: "Security Center", icon: ShieldCheck }, { to: "/complaints", label: "Complaints", icon: ClipboardList },
      { to: "/history", label: "History", icon: History }, { to: "/reports", label: "Reports", icon: BarChart3 },
      { to: "/year-schedule", label: "Year Schedule", icon: Calendar }, { to: "/account", label: "Account settings", icon: KeyRound }
    ],
    teacher: [
      { to: "/faculty", label: "Dashboard", icon: LayoutDashboard }, { to: "/faculty/assignments", label: "Assignments", icon: FileText },
      { to: "/mark-attendance", label: "Mark Attendance", icon: ClipboardCheck }, { to: "/faculty/quiz-generate", label: "QR Attendance", icon: QrCode },
      { to: "/schedule", label: "Class Schedule", icon: CalendarDays }, { to: "/faculty/tools", label: "Marks & Notices", icon: ClipboardCheck }, { to: "/complaints", label: "Complaints", icon: ClipboardList },
      { to: "/year-schedule", label: "Year Schedule", icon: Calendar }, { to: "/account", label: "Account settings", icon: KeyRound }
    ],
    student: [
      { to: "/student", label: "Dashboard", icon: LayoutDashboard }, { to: "/assignments", label: "Assignments", icon: FileText },
      { to: "/schedule", label: "Schedule", icon: CalendarDays }, { to: "/teachers", label: "Teachers", icon: UsersRound },
      { to: "/complaints", label: "Complaints", icon: ClipboardList }, { to: "/student-records", label: "Student List", icon: UsersRound },
      { to: "/history", label: "History", icon: History }, { to: "/profile", label: "Profile", icon: UserRound },
      { to: "/year-schedule", label: "Year Schedule", icon: Calendar }, { to: "/account", label: "Account settings", icon: KeyRound }
    ]
  };
  const links = linksByRole[user?.role] || [];
  const roleLabel = user?.role === "admin" ? "Admin workspace" : user?.role === "teacher" ? "Faculty workspace" : "Student workspace";

  function signOut() {
    logout();
    showToast?.("You have been signed out.", "success");
    navigate("/");
  }

  return (
    <div className="app-shell">
      <div className={`sidebar-backdrop ${sidebarOpen ? "visible" : ""}`} onClick={() => setSidebarOpen(false)} />
      <aside className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
        <div className="sidebar-brand-row">
          <div className="brand"><div className="brand-mark"><GraduationCap size={23} /></div><div><strong>College Portal</strong><span>Operations hub</span></div></div>
          <button className="mobile-close icon-button" type="button" aria-label="Close navigation" onClick={() => setSidebarOpen(false)}><X size={18} /></button>
        </div>
        <div className="workspace-label"><span className="status-dot" /> Live workspace <span className="workspace-role">{user?.role}</span></div>
        <nav aria-label="Primary navigation">
          <span className="nav-section-label">Workspace</span>
          {links.map((item) => <NavLink key={item.to} to={item.to} className="nav-link" onClick={() => setSidebarOpen(false)}><item.icon size={18} /><span>{item.label}</span><span className="nav-arrow">›</span></NavLink>)}
        </nav>
        <div className="sidebar-footer"><div className="sidebar-help"><span className="help-orb"><Bell size={16} /></span><div><strong>Stay on top</strong><span>Review your latest updates</span></div></div><button className="ghost-button logout" onClick={signOut}><LogOut size={18} /> Sign out</button></div>
      </aside>
      <main className="main-area">
        <header className="topbar">
          <div className="mobile-topbar"><button className="menu-button icon-button" type="button" aria-label="Open navigation" onClick={() => setSidebarOpen(true)}><Menu size={21} /></button><div className="mobile-brand"><GraduationCap size={20} /> Portal</div></div>
          <div className="topbar-title"><span className="eyebrow">{roleLabel}</span><h1>{user?.name}</h1><p>Here’s what’s happening across your campus today.</p></div>
          <div className="topbar-actions"><GlobalSearch /><NotificationCenter /><button className="profile-chip" type="button" onClick={() => navigate("/account")}><span className="avatar">{user?.name?.slice(0, 1).toUpperCase()}</span><span className="profile-copy"><strong>{user?.name}</strong><small>{user?.role}</small></span></button></div>
        </header>
        <div className="page-content">{children}</div>
      </main>
    </div>
  );
}
