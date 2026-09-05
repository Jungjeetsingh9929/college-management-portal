import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext.jsx";
import { AppLayout } from "./components/AppLayout.jsx";
import { AdminDashboard } from "./pages/AdminDashboard.jsx";
import { AttendanceHistory } from "./pages/AttendanceHistory.jsx";
import { Complaints } from "./pages/Complaints.jsx";
import { Home } from "./pages/Home.jsx";
import { Login } from "./pages/Login.jsx";
import { Reports } from "./pages/Reports.jsx";
import { Schedule } from "./pages/Schedule.jsx";
import { StudentAssignments } from "./pages/StudentAssignments.jsx";
import { StudentDashboard } from "./pages/StudentDashboard.jsx";
import { StudentProfile } from "./pages/StudentProfile.jsx";
import { AccountSettings } from "./pages/AccountSettings.jsx";
import { SubjectManagement } from "./pages/SubjectManagement.jsx";
import { Teachers } from "./pages/Teachers.jsx";
import { FacultyDashboard } from "./pages/FacultyDashboard.jsx";
import { FacultyAssignments } from "./pages/FacultyAssignments.jsx";
import { QuizGenerator } from "./pages/QuizGenerator.jsx";
import { QuizAnswer } from "./pages/QuizAnswer.jsx";
import { YearSchedule } from "./pages/YearSchedule.jsx";
import "./styles.css";

function ProtectedRoute({ children, role }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="screen-loader">Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (role && user.role !== role) return <Navigate to={user.role === "admin" ? "/admin" : user.role === "teacher" ? "/faculty" : "/student"} replace />;
  return children;
}

function AppRoutes() {
  return (
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
        path="/teachers"
        element={
          <ProtectedRoute>
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
    </Routes>
  );
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  </React.StrictMode>
);
