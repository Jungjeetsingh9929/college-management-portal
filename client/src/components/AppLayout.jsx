import React, { useEffect, useState } from "react";
import { Activity, Award, BarChart3, Bell, BookOpen, Camera, Building2, CalendarClock, CalendarDays, ClipboardCheck, ClipboardList, CreditCard, GraduationCap, History, KeyRound, LayoutDashboard, LogOut, Menu, ShieldCheck, UserRound, UsersRound, Calendar, FileText, QrCode, X } from "lucide-react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { GlobalSearch } from "./GlobalSearch.jsx";
import { NotificationCenter } from "./NotificationCenter.jsx";
import { ProtectedImage } from "./ProtectedImage.jsx";
import { QuizNotifications } from "./QuizNotifications.jsx";
import { useToast } from "./UI.jsx";

// The top bar previously always showed the user's initial, even for a
// student with an approved profile photo (see the "top-bar avatar" note in
// PHOTO_APPROVAL_CHANGELOG.md). `user.approvedPhotoId` now travels on the
// already-loaded AuthContext user (set by /auth/login and /auth/me), so
// this doesn't add a fetch per navigation - only ProtectedImage's own
// one-time image fetch, the same mechanism StudentProfile.jsx already uses.
function TopbarAvatar({ user }) {
  const initial = user?.name?.slice(0, 1).toUpperCase();
  if (user?.role === "student" && user?.approvedPhotoId) {
    return <ProtectedImage photoId={user.approvedPhotoId} alt="" className="avatar-photo-topbar" fallback={<span className="avatar">{initial}</span>} />;
  }
  return <span className="avatar">{initial}</span>;
}

export function AppLayout({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { showToast } = useToast() || {};
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  // Mobile drawer: close on route change and on Escape.
  useEffect(() => { setSidebarOpen(false); }, [location.pathname]);
  useEffect(() => {
    if (!sidebarOpen) return undefined;
    const onKey = (event) => { if (event.key === "Escape") setSidebarOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sidebarOpen]);
  const linksByRole = {
    admin: [
      { to: "/admin", label: "Dashboard", icon: LayoutDashboard }, { to: "/subjects", label: "Subjects", icon: BookOpen }, { to: "/marks", label: "Marks & Results", icon: Award },
      { to: "/attendance-center", label: "Attendance Center", icon: Activity }, { to: "/mark-attendance", label: "Mark Attendance", icon: ClipboardCheck }, { to: "/central-timetable", label: "Central Timetable", icon: CalendarDays }, { to: "/schedule", label: "Schedule", icon: CalendarDays }, { to: "/events", label: "Events Calendar", icon: CalendarClock }, { to: "/library", label: "Digital Library", icon: BookOpen },
      { to: "/teachers", label: "Teachers", icon: UsersRound }, { to: "/fees", label: "Fees & Notices", icon: CreditCard }, { to: "/admin/resources", label: "Departments & Rooms", icon: Building2 }, { to: "/admin/security", label: "Security Center", icon: ShieldCheck }, { to: "/photo-approvals", label: "Photo Approvals", icon: Camera }, { to: "/complaints", label: "Complaints", icon: ClipboardList },
      { to: "/history", label: "History", icon: History }, { to: "/reports", label: "Reports", icon: BarChart3 },
      { to: "/year-schedule", label: "Year Schedule", icon: Calendar }, { to: "/account", label: "Account settings", icon: KeyRound }
    ],
    teacher: [
      { to: "/faculty", label: "Dashboard", icon: LayoutDashboard }, { to: "/fees", label: "Fees & Notices", icon: CreditCard }, { to: "/faculty/assignments", label: "Assignments", icon: FileText },
      { to: "/attendance-center", label: "Attendance Center", icon: Activity }, { to: "/mark-attendance", label: "Mark Attendance", icon: ClipboardCheck }, { to: "/faculty/quiz-generate", label: "QR Attendance", icon: QrCode },
      { to: "/schedule", label: "Class Schedule", icon: CalendarDays }, { to: "/events", label: "Events Calendar", icon: CalendarClock }, { to: "/library", label: "Digital Library", icon: BookOpen }, { to: "/marks", label: "Marks & Results", icon: Award }, { to: "/faculty/tools", label: "Notes & Notices", icon: ClipboardCheck }, { to: "/complaints", label: "Complaints", icon: ClipboardList },
      { to: "/year-schedule", label: "Year Schedule", icon: Calendar }, { to: "/account", label: "Account settings", icon: KeyRound }
    ],
    student: [
      { to: "/student", label: "Dashboard", icon: LayoutDashboard }, { to: "/assignments", label: "Assignments", icon: FileText }, { to: "/my-results", label: "My Results", icon: Award },
      { to: "/schedule", label: "Schedule", icon: CalendarDays }, { to: "/events", label: "Events Calendar", icon: CalendarClock }, { to: "/library", label: "Digital Library", icon: BookOpen }, { to: "/teachers", label: "Teachers", icon: UsersRound },
      { to: "/complaints", label: "Complaints", icon: ClipboardList }, { to: "/my-fees", label: "Fees & Payments", icon: CreditCard }, { to: "/student-records", label: "My Student Record", icon: UsersRound },
      { to: "/history", label: "History", icon: History }, { to: "/profile", label: "Profile", icon: UserRound },
      { to: "/year-schedule", label: "Year Schedule", icon: Calendar }, { to: "/account", label: "Account settings", icon: KeyRound }
    ]
  };
  const links = [...(linksByRole[user?.role] || [])].filter(
    (link) => link.to !== "/fees" || user?.role === "admin" || (user?.role === "teacher" && user?.isHod)
  );
  if (user?.role === "teacher" && user?.isHod) links.splice(1, 0, { to: "/hod", label: "HOD Center", icon: Building2 });
  const roleLabel = user?.role === "admin" ? "Admin workspace" : user?.isHod ? "HOD workspace" : user?.role === "teacher" ? "Faculty workspace" : "Student workspace";

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
          <div className="topbar-actions"><GlobalSearch /><QuizNotifications /><NotificationCenter /><button className="profile-chip" type="button" onClick={() => navigate("/account")}><TopbarAvatar user={user} /><span className="profile-copy"><strong>{user?.name}</strong><small>{user?.role}</small></span></button></div>
        </header>
        <div className="page-content">{children}</div>
      </main>
    </div>
  );
}
