import React, { useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { CheckCircle2, MapPin, QrCode, XCircle } from "lucide-react";
import { apiFetch } from "../context/api.js";
import { getLocation } from "../utils/geolocation.js";
import { getDeviceFingerprint } from "../utils/device.js";

// Reached by scanning the QR code shown on the Attendance Command Center
// (or by tapping the "live attendance" notification). The route is wrapped
// in ProtectedRoute, so an unauthenticated scan is bounced through
// /login?returnTo=/attend/<id>?t=<token> and lands back here right after
// login - no extra redirect handling needed here.
export function AttendCheckIn() {
  const { sessionId } = useParams();
  const [searchParams] = useSearchParams();
  const qrToken = searchParams.get("t") || "";
  const navigate = useNavigate();

  const [status, setStatus] = useState("idle"); // idle | locating | submitting | success | error
  const [message, setMessage] = useState("");

  async function checkIn() {
    if (!qrToken) {
      setStatus("error");
      setMessage("This link is missing its check-in code. Please rescan the QR code on the classroom screen.");
      return;
    }
    setMessage("");
    setStatus("locating");
    try {
      // This is what enforces "on campus only": the request is rejected
      // server-side unless these coordinates fall inside the college geofence.
      const coords = await getLocation("check in to this attendance session");
      setStatus("submitting");
      const data = await apiFetch("/attendance/check-in", {
        method: "POST",
        body: JSON.stringify({
          sessionId,
          qrToken,
          nonce: crypto.randomUUID(),
          latitude: coords.latitude,
          longitude: coords.longitude,
          accuracy: coords.accuracy,
          deviceFingerprint: getDeviceFingerprint()
        })
      });

      setStatus("success");
      setMessage(`You're marked ${data.record?.status || "present"} for ${data.record?.subjectName || "this class"}.`);

      // If the teacher also has a live question running for the same
      // subject, continue straight there instead of stopping here.
      let nextRoute = "/student";
      try {
        const quizData = await apiFetch("/shared/quiz/active");
        const match = (quizData.quizzes || []).find((quiz) => quiz.subjectId === data.record?.subjectId);
        if (match) nextRoute = `/student/quiz/${match.id}`;
      } catch {
        // Non-fatal - the student is already checked in either way, they
        // just won't get auto-forwarded to a live question.
      }
      window.setTimeout(() => navigate(nextRoute, { replace: true }), nextRoute === "/student" ? 2200 : 1200);
    } catch (err) {
      setStatus("error");
      setMessage(err.message);
    }
  }

  return (
    <div className="dashboard-content">
      <div className="card" style={{ maxWidth: 460, margin: "2.5rem auto", textAlign: "center" }}>
        <QrCode size={30} style={{ marginBottom: 10 }} />
        <h2>Attendance check-in</h2>

        {status === "idle" && (
          <>
            <p style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, color: "#666" }}>
              <MapPin size={16} /> You must be on campus — your device's location is checked when you check in.
            </p>
            <button className="primary-button full" onClick={checkIn}>Check in now</button>
          </>
        )}

        {(status === "locating" || status === "submitting") && (
          <p className="muted">{status === "locating" ? "Checking your location…" : "Submitting your check-in…"}</p>
        )}

        {status === "success" && (
          <div className="success-box" style={{ margin: "1rem 0", display: "flex", alignItems: "center", gap: 8, justifyContent: "center" }}>
            <CheckCircle2 size={18} /> <span>{message}</span>
          </div>
        )}

        {status === "error" && (
          <>
            <div className="error-box" style={{ margin: "1rem 0", display: "flex", alignItems: "center", gap: 8, justifyContent: "center" }}>
              <XCircle size={18} /> <span>{message}</span>
            </div>
            <button className="primary-button full" onClick={checkIn}>Try again</button>
          </>
        )}

        <div style={{ marginTop: "1.5rem" }}>
          <button className="ghost-button" onClick={() => navigate("/student")}>Back to dashboard</button>
        </div>
      </div>
    </div>
  );
}
