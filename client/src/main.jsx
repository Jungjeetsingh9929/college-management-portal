import React, { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext.jsx";
import { AppLayout } from "./components/AppLayout.jsx";
const page = (loader, name) => lazy(() => loader().then((module) => ({ default: module[name] })));
const AdminDashboard = page(() => import("./pages/AdminDashboard.jsx"), "AdminDashboard");
const AttendanceHistory = page(() => import("./pages/AttendanceHistory.jsx"), "AttendanceHistory");
const Complaints = page(() => import("./pages/Complaints.jsx"), "Complaints");
const Home = page(() => import("./pages/Home.jsx"), "Home");
const Login = page(() => import("./pages/Login.jsx"), "Login");
const Reports = page(() => import("./pages/Reports.jsx"), "Reports");
const Schedule = page(() => import("./pages/Schedule.jsx"), "Schedule");
const CentralTimetable = page(() => import("./pages/CentralTimetable.jsx"), "CentralTimetable");
const StudentAssignments = page(() => import("./pages/StudentAssignments.jsx"), "StudentAssignments");
const StudentDashboard = page(() => import("./pages/StudentDashboard.jsx"), "StudentDashboard");
const StudentProfile = page(() => import("./pages/StudentProfile.jsx"), "StudentProfile");
const StudentRecords = page(() => import("./pages/StudentRecords.jsx"), "StudentRecords");
const AccountSettings = page(() => import("./pages/AccountSettings.jsx"), "AccountSettings");
const SubjectManagement = page(() => import("./pages/SubjectManagement.jsx"), "SubjectManagement");
const AdminResources = page(() => import("./pages/AdminResources.jsx"), "AdminResources");
const SecurityDashboard = page(() => import("./pages/SecurityDashboard.jsx"), "SecurityDashboard");
const Teachers = page(() => import("./pages/Teachers.jsx"), "Teachers");
const FacultyDashboard = page(() => import("./pages/FacultyDashboard.jsx"), "FacultyDashboard");
const FacultyAssignments = page(() => import("./pages/FacultyAssignments.jsx"), "FacultyAssignments");
const FacultyTools = page(() => import("./pages/FacultyTools.jsx"), "FacultyTools");
const MarkAttendance = page(() => import("./pages/MarkAttendance.jsx"), "MarkAttendance");
const AttendanceCommandCenter = page(() => import("./pages/AttendanceCommandCenter.jsx"), "AttendanceCommandCenter");
const QuizGenerator = page(() => import("./pages/QuizGenerator.jsx"), "QuizGenerator");
const QuizAnswer = page(() => import("./pages/QuizAnswer.jsx"), "QuizAnswer");
const QuizSession = page(() => import("./pages/QuizSession.jsx"), "QuizSession");
const AttendCheckIn = page(() => import("./pages/AttendCheckIn.jsx"), "AttendCheckIn");
const YearSchedule = page(() => import("./pages/YearSchedule.jsx"), "YearSchedule");
const HODCenter = page(() => import("./pages/HODCenter.jsx"), "HODCenter");
const DepartmentDetail = page(() => import("./pages/DepartmentDetail.jsx"), "DepartmentDetail");
const FeesCenter = page(() => import("./pages/FeesCenter.jsx"), "FeesCenter");
const MyFees = page(() => import("./pages/MyFees.jsx"), "MyFees");
const EventsCalendar = page(() => import("./pages/EventsCalendar.jsx"), "EventsCalendar");
const DigitalLibrary = page(() => import("./pages/DigitalLibrary.jsx"), "DigitalLibrary");
const PhotoApprovals = page(() => import("./pages/PhotoApprovals.jsx"), "PhotoApprovals");
const MarksCenter = page(() => import("./pages/MarksCenter.jsx"), "MarksCenter");
const MarksSheet = page(() => import("./pages/MarksSheet.jsx"), "MarksSheet");
const MyResults = page(() => import("./pages/MyResults.jsx"), "MyResults");
import { ToastProvider } from "./components/UI.jsx";
import "./styles.css";

function ProtectedRoute({ children, role, roles, hodOnly = false }) {
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
  if (hodOnly && user.role === "teacher" && !user.isHod) return <Navigate to="/faculty" replace />;
  return children;
}

function AppRoutes() {
  return (
    <Suspense fallback={<div className="screen-loader">Loading page...</div>}>
      <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<Login />} />
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
        path="/events"
        element={
          <ProtectedRoute>
            <AppLayout>
              <EventsCalendar />
            </AppLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/library"
        element={
          <ProtectedRoute>
            <AppLayout>
              <DigitalLibrary />
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
        path="/my-fees"
        element={
          <ProtectedRoute role="student">
            <AppLayout>
              <MyFees />
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
        path="/photo-approvals"
        element={
          <ProtectedRoute role="admin">
            <AppLayout>
              <PhotoApprovals />
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
          <ProtectedRoute roles={["student", "teacher", "admin"]}>
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
      <Route path="/marks" element={<ProtectedRoute roles={["teacher", "admin"]}><AppLayout><MarksCenter /></AppLayout></ProtectedRoute>} />
      <Route path="/marks/:subjectId" element={<ProtectedRoute roles={["teacher", "admin"]}><AppLayout><MarksSheet /></AppLayout></ProtectedRoute>} />
      <Route path="/my-results" element={<ProtectedRoute role="student"><AppLayout><MyResults /></AppLayout></ProtectedRoute>} />
      <Route path="/hod" element={<ProtectedRoute role="teacher" hodOnly><AppLayout><HODCenter /></AppLayout></ProtectedRoute>} />
      <Route path="/fees" element={<ProtectedRoute roles={["admin", "teacher"]} hodOnly><AppLayout><FeesCenter /></AppLayout></ProtectedRoute>} />
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
      <Route path="/attendance-center" element={<ProtectedRoute roles={["teacher", "admin"]}><AppLayout><AttendanceCommandCenter /></AppLayout></ProtectedRoute>} />
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
      <Route path="/student/quiz-session/:id" element={<ProtectedRoute role="student"><AppLayout><QuizSession /></AppLayout></ProtectedRoute>} />
      <Route path="/attend/:sessionId" element={<ProtectedRoute role="student"><AppLayout><AttendCheckIn /></AppLayout></ProtectedRoute>} />
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
        </BrowserRouter>
      </AuthProvider>
    </ToastProvider>
  </React.StrictMode>
);
