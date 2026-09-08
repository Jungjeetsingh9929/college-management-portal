import React, { useState } from "react";
import { ScanLine } from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

export function ResetPassword() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(event) {
    event.preventDefault();
    if (submitting) return;
    setError("");
    setMessage("");
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setSubmitting(true);
    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Password reset failed.");
      setMessage(data.message || "Password reset successfully. Please sign in again.");
      setNewPassword("");
      setConfirmPassword("");
      setTimeout(() => navigate("/login"), 2000);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
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
            <span>Reset your password</span>
          </div>
        </div>
        {!token ? (
          <div className="error-box">
            This reset link is missing its token. Please request a new one from the login page.
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="form-stack" autoComplete="off">
            <label>
              New password
              <input
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                type="password"
                autoComplete="new-password"
                required
              />
            </label>
            <label>
              Confirm new password
              <input
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                type="password"
                autoComplete="new-password"
                required
              />
            </label>
            {error && <div className="error-box">{error}</div>}
            {message && <div className="success-box">{message}</div>}
            <button className="primary-button full" type="submit" disabled={submitting} aria-busy={submitting}>
              {submitting ? "Resetting…" : "Reset password"}
            </button>
          </form>
        )}
        <Link to="/login" className="link-button" style={{ display: "block", marginTop: 12 }}>
          Back to login
        </Link>
      </section>
    </main>
  );
}
