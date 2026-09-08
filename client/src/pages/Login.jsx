import React, { useState } from "react";
import { ScanLine } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";

const blankRequest = { name: "", role: "student", rollNumber: "", className: "CSE 3A", department: "Computer Science", email: "", password: "", phone: "", guardian: "", graduationYear: "2028" };

async function postJson(path, body) {
  const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || "Request failed.");
  return data;
}

export function Login() {
  const [role, setRole] = useState("student");
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [requestForm, setRequestForm] = useState(blankRequest);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  function clearFeedback() { setError(""); setMessage(""); }
  function switchMode(next) { setMode(next); clearFeedback(); setOtp(""); }
  function switchRole(nextRole) { setRole(nextRole); setEmail(""); setPassword(""); clearFeedback(); }

  async function handleSubmit(event) {
    event.preventDefault(); if (submitting) return; clearFeedback(); setSubmitting(true);
    try {
      const user = await login({ email, password, role });
      const requestedPath = new URLSearchParams(location.search).get("returnTo");
      const returnTo = requestedPath && requestedPath.startsWith("/") && !requestedPath.startsWith("//") ? requestedPath : "";
      navigate(returnTo || (user.role === "admin" ? "/admin" : user.role === "teacher" ? "/faculty" : "/student"));
    } catch (err) { setError(err.message || "Login failed. Please verify your credentials and role."); } finally { setSubmitting(false); }
  }

  async function requestSignupOtp(event) {
    event.preventDefault(); if (submitting) return; clearFeedback(); setSubmitting(true);
    try { await postJson("/api/auth/signup/request-otp", requestForm); setEmail(requestForm.email); setMode("signupOtp"); setMessage("A six-digit verification code was sent to your email."); }
    catch (err) { setError(err.message); } finally { setSubmitting(false); }
  }

  async function verifySignupOtp(event) {
    event.preventDefault(); if (submitting) return; clearFeedback(); setSubmitting(true);
    try { const data = await postJson("/api/auth/signup/verify-otp", { email: requestForm.email, otp }); setMessage(data.message); setMode("login"); setRequestForm(blankRequest); setOtp(""); }
    catch (err) { setError(err.message); } finally { setSubmitting(false); }
  }

  async function requestPasswordOtp(event) {
    event.preventDefault(); if (submitting) return; clearFeedback(); setSubmitting(true);
    try { const data = await postJson("/api/auth/request-password-otp", { email }); setMessage(data.message); setMode("forgotOtp"); }
    catch (err) { setError(err.message); } finally { setSubmitting(false); }
  }

  async function resetPasswordOtp(event) {
    event.preventDefault(); if (submitting) return; clearFeedback(); setSubmitting(true);
    try { const data = await postJson("/api/auth/reset-password-otp", { email, otp, newPassword: password }); setMessage(data.message); setMode("login"); setPassword(""); setOtp(""); }
    catch (err) { setError(err.message); } finally { setSubmitting(false); }
  }

  const requestFields = [["name", "Full name", "text"], ["rollNumber", "Roll / Enrollment no.", "text"], ["className", "Class / Section", "text"], ["department", "Department", "text"], ["email", "Gmail / email", "email"], ["password", "Password", "password"], ["phone", "Phone", "tel"], ["guardian", "Guardian name", "text"], ["graduationYear", "Graduation year", "text"]];

  return <main className="login-page"><section className="login-card">
    <div className="brand centered"><div className="brand-mark"><ScanLine size={24} /></div><div><strong>College Portal</strong><span>Secure campus access</span></div></div>
    {mode !== "signupOtp" && mode !== "forgotOtp" && <div className="segmented"><button className={mode === "login" || mode === "forgot" ? "active" : ""} onClick={() => switchMode("login")}>Login</button><button className={mode === "request" ? "active" : ""} onClick={() => switchMode("request")}>Request access</button></div>}
    {message && <div className="success-box">{message}</div>}
    {error && <div className="error-box">{error}</div>}

    {mode === "signupOtp" ? <form onSubmit={verifySignupOtp} className="form-stack"><p className="muted-text">Enter the code sent to <strong>{requestForm.email}</strong>. It expires in 10 minutes.</p><label>Email verification code<input value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required /></label><button className="primary-button full" disabled={submitting}>{submitting ? "Verifying…" : "Verify email"}</button><button type="button" className="link-button" onClick={() => switchMode("request")}>Back to signup</button></form>
      : mode === "forgotOtp" ? <form onSubmit={resetPasswordOtp} className="form-stack"><p className="muted-text">Enter the code sent to <strong>{email}</strong> and choose a new password.</p><label>Verification code<input value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required /></label><label>New password<input value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete="new-password" required /></label><button className="primary-button full" disabled={submitting}>{submitting ? "Updating…" : "Reset password"}</button><button type="button" className="link-button" onClick={() => switchMode("forgot")}>Send another code</button></form>
      : mode === "request" ? <form onSubmit={requestSignupOtp} className="form-stack"><div className="signup-note">Choose Student or Faculty. An existing admin must approve your request before you can sign in. Admin accounts cannot be created through signup.</div><label>Requested role<select value={requestForm.role} onChange={(e) => setRequestForm({ ...requestForm, role: e.target.value })}><option value="student">Student</option><option value="faculty">Faculty</option></select></label>{requestFields.map(([field, label, type]) => <label key={field}>{label}<input type={type} value={requestForm[field]} onChange={(e) => setRequestForm({ ...requestForm, [field]: e.target.value })} required={["name", "email", "password"].includes(field)} /></label>)}<button className="primary-button full" disabled={submitting}>{submitting ? "Sending code…" : "Verify email and request access"}</button></form>
      : mode === "forgot" ? <form onSubmit={requestPasswordOtp} className="form-stack"><p className="muted-text">We will send a six-digit password reset code to your registered email.</p><label>Registered email<input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required /></label><button className="primary-button full" disabled={submitting}>{submitting ? "Sending…" : "Send reset code"}</button><button type="button" className="link-button" onClick={() => switchMode("login")}>Back to login</button></form>
      : <><div className="segmented role-switcher"><button className={role === "student" ? "active" : ""} onClick={() => switchRole("student")}>Student</button><button className={role === "teacher" ? "active" : ""} onClick={() => switchRole("teacher")}>Faculty</button><button className={role === "admin" ? "active" : ""} onClick={() => switchRole("admin")}>Admin</button></div><form onSubmit={handleSubmit} className="form-stack"><label>Email<input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required /></label><label>Password<input value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete="current-password" required /></label><button className="primary-button full" disabled={submitting}>{submitting ? "Signing in…" : "Login"}</button><button type="button" className="link-button" onClick={() => switchMode("forgot")}>Forgot password? Use email OTP</button></form></>}
  </section></main>;
}
