import React, { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, CheckCircle2, QrCode, RefreshCw, ShieldCheck } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { apiFetch } from "../context/api.js";
import { Badge, EmptyState } from "../components/UI.jsx";

// Live sessions stay open while faculty push new questions, so this page
// polls in the background instead of relying on a single fetch-on-mount.
const POLL_INTERVAL_MS = 5000;

export function QuizSession() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [session, setSession] = useState(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const pollRef = useRef(null);
  const mountedRef = useRef(true);

  const fetchSession = useCallback(async ({ silent } = {}) => {
    if (silent) setRefreshing(true);
    try {
      const data = await apiFetch(`/shared/quiz-session/${id}`);
      if (!mountedRef.current) return;
      setSession(data.session);
      // A session that has ended stops updating; no point polling further.
      if (data.session && new Date(data.session.endsAt).getTime() <= Date.now() && pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      if (!silent) setError("");
    } catch (err) {
      if (!mountedRef.current) return;
      // Once we already have a session loaded, a transient poll failure
      // shouldn't blow away the UI — only surface the error on first load.
      if (!silent && !session) setError(err.message);
    } finally {
      if (mountedRef.current && silent) setRefreshing(false);
    }
  }, [id, session]);

  useEffect(() => {
    mountedRef.current = true;
    fetchSession();
    pollRef.current = setInterval(() => fetchSession({ silent: true }), POLL_INTERVAL_MS);
    return () => {
      mountedRef.current = false;
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (error) return <div className="page-stack"><div className="error-box">{error}</div><button className="secondary-button" onClick={() => navigate("/student")}>Back to student panel</button></div>;
  if (!session) return <div className="loading-panel">Opening classroom question session…</div>;

  const ended = new Date(session.endsAt).getTime() <= Date.now();

  return (
    <div className="page-stack student-quiz-session">
      <section className="attendance-hero">
        <div>
          <span className="eyebrow">Live classroom / verified question</span>
          <h2>{session.title}</h2>
          <p>{session.subjectName} · {session.className} · started by {session.teacherName}</p>
        </div>
        <div className="live-indicator"><i /> {ended ? "Session ended" : `Live until ${new Date(session.endsAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}</div>
      </section>
      <section className="panel session-instructions">
        <ShieldCheck size={19} />
        <div>
          <strong>One secure path from QR to question</strong>
          <span>You are signed in as a student in this class. Open an unanswered question below, answer it, and allow location access when submitting attendance.</span>
        </div>
      </section>
      <section className="panel">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Questions from your faculty</span>
            <h2>{session.questions.length} available</h2>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            {!ended && <button type="button" className="ghost-button" onClick={() => fetchSession({ silent: true })} disabled={refreshing} title="Refresh questions">
              <RefreshCw size={16} className={refreshing ? "spin" : ""} /> {refreshing ? "Checking…" : "Refresh"}
            </button>}
            <QrCode size={19} />
          </div>
        </div>
        {session.questions.length ? (
          <div className="student-question-list">
            {session.questions.map((question, index) => (
              <button className={`student-question-card ${question.attempted ? "attempted" : ""}`} key={question.id} disabled={question.attempted} onClick={() => navigate(`/student/quiz/${question.id}`)}>
                <span className="question-number">{index + 1}</span>
                <div>
                  <strong>{question.question}</strong>
                  <span>{question.attempted ? "Submitted · attendance result recorded" : `${question.options.length} answer choices · tap to open`}</span>
                </div>
                {question.attempted ? <CheckCircle2 size={19} /> : <ArrowRight size={19} />}
                {question.attempted && <Badge value="completed" />}
              </button>
            ))}
          </div>
        ) : (
          <EmptyState title="Your faculty is preparing the question" text={ended ? "This session has ended without any questions." : "Keep this page open — new questions appear automatically, roughly every few seconds."} />
        )}
      </section>
      <button className="ghost-button" onClick={() => navigate("/student")}>Back to student panel</button>
    </div>
  );
}
