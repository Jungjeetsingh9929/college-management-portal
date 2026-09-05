import React, { useEffect, useRef, useState } from "react";
import { Bell, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../context/api.js";
import { useAuth } from "../context/AuthContext.jsx";

const POLL_INTERVAL_MS = 20_000;

// Polls for active, unattempted attendance questions for the student's class
// and surfaces them as an in-app bell + toast. Also fires a real browser
// notification (if the student grants permission) so they're alerted even if
// the portal tab isn't focused, without requiring server-side push infra.
export function QuizNotifications() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [quizzes, setQuizzes] = useState([]);
  const [open, setOpen] = useState(false);
  const seenIds = useRef(new Set());
  const firstLoad = useRef(true);

  useEffect(() => {
    if (user?.role !== "student") return;
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, [user]);

  useEffect(() => {
    if (user?.role !== "student") return;

    let cancelled = false;

    async function poll() {
      try {
        const data = await apiFetch("/shared/quiz/active");
        if (cancelled) return;
        const active = data.quizzes || [];
        setQuizzes(active);

        if (!firstLoad.current) {
          const newOnes = active.filter((q) => !seenIds.current.has(q.id));
          newOnes.forEach((q) => {
            if ("Notification" in window && Notification.permission === "granted") {
              const note = new Notification("Attendance question posted", {
                body: `${q.subjectName}: answer now to be marked present.`,
                tag: q.id
              });
              note.onclick = () => {
                window.focus();
                navigate(`/student/quiz/${q.id}`);
              };
            }
          });
        }
        firstLoad.current = false;
        seenIds.current = new Set(active.map((q) => q.id));
      } catch {
        // Silently ignore poll failures (e.g. brief network hiccup) and retry next tick.
      }
    }

    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [user, navigate]);

  if (user?.role !== "student" || quizzes.length === 0) return null;

  return (
    <div style={{ position: "relative" }}>
      <button
        className="ghost-button"
        onClick={() => setOpen((v) => !v)}
        style={{ position: "relative" }}
        aria-label="Attendance question notifications"
      >
        <Bell size={18} />
        <span
          style={{
            position: "absolute",
            top: -4,
            right: -4,
            background: "#dc2626",
            color: "#fff",
            borderRadius: "999px",
            fontSize: "0.7rem",
            lineHeight: 1,
            padding: "3px 6px"
          }}
        >
          {quizzes.length}
        </span>
      </button>
      {open && (
        <div
          className="panel"
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 8px)",
            width: 300,
            zIndex: 20,
            boxShadow: "0 8px 24px rgba(0,0,0,0.15)"
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <strong>Attendance questions</strong>
            <button className="ghost-button small" onClick={() => setOpen(false)} aria-label="Close">
              <X size={16} />
            </button>
          </div>
          <div className="list-stack">
            {quizzes.map((q) => (
              <div
                key={q.id}
                className="list-row"
                style={{ cursor: "pointer" }}
                onClick={() => {
                  setOpen(false);
                  navigate(`/student/quiz/${q.id}`);
                }}
              >
                <div>
                  <strong>{q.subjectName}</strong>
                  <span>Answer now &mdash; must be on campus</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
