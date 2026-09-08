import React, { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext.jsx";
import { AppLayout } from "./components/AppLayout.jsx";
const AdminDashboard = lazy(() => import("./pages/AdminDashboard.jsx").then((module) => ({ default: module.AdminDashboard })));
const AttendanceHistory = lazy(() => import("./pages/AttendanceHistory.jsx").then((module) => ({ default: module.AttendanceHistory })));
const Complaints = lazy(() => import("./pages/Complaints.jsx").then((module) => ({ default: module.Complaints })));
const Home = lazy(() => import("./pages/Home.jsx").then((module) => ({ default: module.Home })));
const Login = lazy(() => import("./pages/Login.jsx").then((module) => ({ default: module.Login })));
const ResetPassword = lazy(() => import("./pages/ResetPassword.jsx").then((module) => ({ default: module.ResetPassword })));
const Reports = lazy(() => import("./pages/Reports.jsx").then((module) => ({ default: module.Reports })));
const Schedule = lazy(() => import("./pages/Schedule.jsx").then((module) => ({ default: module.Schedule })));
const CentralTimetable = lazy(() => import("./pages/CentralTimetable.jsx").then((module) => ({ default: module.CentralTimetable })));
const StudentAssignments = lazy(() => import("./pages/StudentAssignments.jsx").then((module) => ({ default: module.StudentAssignments })));
const StudentDashboard = lazy(() => import("./pages/StudentDashboard.jsx").then((module) => ({ default: module.StudentDashboard })));
const StudentProfile = lazy(() => import("./pages/StudentProfile.jsx").then((module) => ({ default: module.StudentProfile })));
const StudentRecords = lazy(() => import("./pages/StudentRecords.jsx").then((module) => ({ default: module.StudentRecords })));
const AccountSettings = lazy(() => import("./pages/AccountSettings.jsx").then((module) => ({ default: module.AccountSettings })));
const SubjectManagement = lazy(() => import("./pages/SubjectManagement.jsx").then((module) => ({ default: module.SubjectManagement })));
const AdminResources = lazy(() => import("./pages/AdminResources.jsx").then((module) => ({ default: module.AdminResources })));
const SecurityDashboard = lazy(() => import("./pages/SecurityDashboard.jsx").then((module) => ({ default: module.SecurityDashboard })));
const Teachers = lazy(() => import("./pages/Teachers.jsx").then((module) => ({ default: module.Teachers })));
const FacultyDashboard = lazy(() => import("./pages/FacultyDashboard.jsx").then((module) => ({ default: module.FacultyDashboard })));
const FacultyAssignments = lazy(() => import("./pages/FacultyAssignments.jsx").then((module) => ({ default: module.FacultyAssignments })));
const FacultyTools = lazy(() => import("./pages/FacultyTools.jsx").then((module) => ({ default: module.FacultyTools })));
const MarkAttendance = lazy(() => import("./pages/MarkAttendance.jsx").then((module) => ({ default: module.MarkAttendance })));
const QuizGenerator = lazy(() => import("./pages/QuizGenerator.jsx").then((module) => ({ default: module.QuizGenerator })));
const QuizAnswer = lazy(() => import("./pages/QuizAnswer.jsx").then((module) => ({ default: module.QuizAnswer })));
const YearSchedule = lazy(() => import("./pages/YearSchedule.jsx").then((module) => ({ default: module.YearSchedule })));
const HODCenter = lazy(() => import("./pages/HODCenter.jsx").then((module) => ({ default: module.HODCenter })));
const DepartmentDetail = lazy(() => import("./pages/DepartmentDetail.jsx").then((module) => ({ default: module.DepartmentDetail })));
const FeesCenter = lazy(() => import("./pages/FeesCenter.jsx").then((module) => ({ default: module.FeesCenter })));
import { PwaInstallPrompt } from "./components/PwaInstallPrompt.jsx";
import { ToastProvider } from "./components/UI.jsx";
import "./styles.css";

function ProtectedRoute({ children, role, roles }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="screen-loader">Loading...</div>;
  if (!user) {
    const returnTo = `${location.pathname}${location.search}${location.hash}`;
    return <Navigate to={`/login?returnTo=${encodeURIComponent(returnTo)}`} replace />;
  }
  const allowedRoles = roles || (role ? [role] : null);
  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return <Navigate to={user.role === "admin" ? "/admin" : user.role === "teacher" ? "/faculty" : "/student"} replace />;
  }
  return children;
}

function AppRoutes() {
  return (
    <Suspense fallback={<div className="screen-loader">Loading page...</div>}>
      <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<Login />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route
        path="/student"
        element={
          <ProtectedRoute role="student">
            <AppLayout>
              <StudentDashboard />
            </AppLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/assignments"
        element={
          <ProtectedRoute role="student">
            <AppLayout>
              <StudentAssignments />
            </AppLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/history"
        element={
          <ProtectedRoute>
            <AppLayout>
              <AttendanceHistory />
            </AppLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/complaints"
        element={
          <ProtectedRoute>
            <AppLayout>
              <Complaints />
            </AppLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/schedule"
        element={
          <ProtectedRoute>
            <AppLayout>
              <Schedule />
            </AppLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/profile"
        element={
          <ProtectedRoute role="student">
            <AppLayout>
              <StudentProfile />
            </AppLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/student-records"
        element={
          <ProtectedRoute role="student">
            <AppLayout>
              <StudentRecords />
            </AppLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/account"
        element={
          <ProtectedRoute>
            <AppLayout>
              <AccountSettings />
            </AppLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin"
        element={
          <ProtectedRoute role="admin">
            <AppLayout>
              <AdminDashboard />
            </AppLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/central-timetable"
        element={
          <ProtectedRoute role="admin">
            <AppLayout>
              <CentralTimetable />
            </AppLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/subjects"
        element={
          <ProtectedRoute role="admin">
            <AppLayout>
              <SubjectManagement />
            </AppLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/resources"
        element={
          <ProtectedRoute role="admin">
            <AppLayout>
              <AdminResources />
            </AppLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/security"
        element={
          <ProtectedRoute role="admin">
            <AppLayout>
              <SecurityDashboard />
            </AppLayout>
          </ProtectedRoute>
        }
      />
      <Route path="/admin/resources/:id" element={<ProtectedRoute role="admin"><AppLayout><DepartmentDetail /></AppLayout></ProtectedRoute>} />
      <Route
        path="/teachers"
        element={
          <ProtectedRoute roles={["teacher", "admin"]}>
            <AppLayout>
              <Teachers />
            </AppLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/reports"
        element={
          <ProtectedRoute role="admin">
            <AppLayout>
              <Reports />
            </AppLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/faculty"
        element={
          <ProtectedRoute role="teacher">
            <AppLayout>
              <FacultyDashboard />
            </AppLayout>
          </ProtectedRoute>
        }
      />
      <Route path="/hod" element={<ProtectedRoute role="teacher"><AppLayout><HODCenter /></AppLayout></ProtectedRoute>} />
      <Route path="/fees" element={<ProtectedRoute roles={["admin", "teacher"]}><AppLayout><FeesCenter /></AppLayout></ProtectedRoute>} />
      <Route
        path="/mark-attendance"
        element={
          <ProtectedRoute roles={["teacher", "admin"]}>
            <AppLayout>
              <MarkAttendance />
            </AppLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/faculty/assignments"
        element={
          <ProtectedRoute role="teacher">
            <AppLayout>
              <FacultyAssignments />
            </AppLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/faculty/quiz-generate"
        element={
          <ProtectedRoute role="teacher">
            <AppLayout>
              <QuizGenerator />
            </AppLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/faculty/tools"
        element={
          <ProtectedRoute role="teacher">
            <AppLayout>
              <FacultyTools />
            </AppLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/student/quiz/:id"
        element={
          <ProtectedRoute role="student">
            <AppLayout>
              <QuizAnswer />
            </AppLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/year-schedule"
        element={
          <ProtectedRoute>
            <AppLayout>
              <YearSchedule />
            </AppLayout>
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((error) => {
      console.error("PWA service worker registration failed", error);
    });
  });
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ToastProvider>
      <AuthProvider>
        <BrowserRouter>
          <AppRoutes />
          <PwaInstallPrompt />
        </BrowserRouter>
      </AuthProvider>
    </ToastProvider>
  </React.StrictMode>
);
