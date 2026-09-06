import React, { useState } from "react";
import { ScanLine } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";

export function Login() {
  const [role, setRole] = useState("student");
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [requestForm, setRequestForm] = useState({
    name: "",
    rollNumber: "",
    className: "CSE 3A",
    department: "Computer Science",
    email: "",
    password: "",
    phone: "",
    guardian: "",
    graduationYear: "2028"
  });
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const { login } = useAuth();
  const navigate = useNavigate();

  function switchRole(nextRole) {
    setRole(nextRole);
    setEmail("");
    setPassword("");
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setMessage("");
    try {
      const user = await login({ email, password, role });
      navigate(user.role === "admin" ? "/admin" : user.role === "teacher" ? "/faculty" : "/student");
    } catch (err) {
      setError(err.message);
    }
  }

  async function submitStudentRequest(event) {
    event.preventDefault();
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/auth/student-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestForm)
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Request failed.");
      setMessage(data.message);
      setRequestForm({
        name: "",
        rollNumber: "",
        className: "CSE 3A",
        department: "Computer Science",
        email: "",
        password: "",
        phone: "",
        guardian: "",
        graduationYear: "2028"
      });
      setMode("login");
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <main className="login-page">
      <section className="login-card">
        <div className="brand centered">
          <div className="brand-mark">
            <ScanLine size={24} />
          </div>
          <div>
            <strong>College Portal</strong>
            <span>Attendance and complaints</span>
          </div>
        </div>
        <div className="segmented">
          <button className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>
            Login
          </button>
          <button className={mode === "request" ? "active" : ""} onClick={() => { setMode("request"); setRole("student"); }}>
            Request ID
          </button>
        </div>
        {mode === "login" && <div className="segmented">
          <button className={role === "student" ? "active" : ""} onClick={() => switchRole("student")}>
            Student
          </button>
          <button className={role === "teacher" ? "active" : ""} onClick={() => switchRole("teacher")}>
            Faculty
          </button>
          <button className={role === "admin" ? "active" : ""} onClick={() => switchRole("admin")}>
            Admin
          </button>
        </div>}
        {message && <div className="success-box">{message}</div>}
        {mode === "request" ? (
          <form onSubmit={submitStudentRequest} className="form-stack" autoComplete="off">
            {[
              ["name", "Student name", "text"],
              ["rollNumber", "Roll / Enrollment no.", "text"],
              ["className", "Class / Section", "text"],
              ["department", "Department", "text"],
              ["email", "Email", "email"],
              ["password", "Password", "password"],
              ["phone", "Phone", "tel"],
              ["guardian", "Guardian name", "text"],
              ["graduationYear", "Graduation year", "text"]
            ].map(([field, label, type]) => (
              <label key={field}>
                {label}
                <input
                  type={type}
                  value={requestForm[field]}
                  onChange={(event) => setRequestForm({ ...requestForm, [field]: event.target.value })}
                  required={["name", "rollNumber", "email", "password"].includes(field)}
                />
              </label>
            ))}
            {error && <div className="error-box">{error}</div>}
            <button className="primary-button full" type="submit">
              Send approval request
            </button>
          </form>
        ) : (
        <form onSubmit={handleSubmit} className="form-stack" autoComplete="off">
          <label>
            Email
            <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="off" required />
          </label>
          <label>
            Password
            <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="new-password" required />
          </label>
          {error && <div className="error-box">{error}</div>}
          <button className="primary-button full" type="submit">
            Login
          </button>
        </form>
        )}
      </section>
    </main>
  );
}
