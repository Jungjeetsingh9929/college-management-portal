import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { MapPin } from "lucide-react";
import { useAuth } from "../context/AuthContext.jsx";
import { apiFetch } from "../context/api.js";
import { getLocation } from "../utils/geolocation.js";

export function QuizAnswer() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  
  const [quiz, setQuiz] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  
  const [selectedOption, setSelectedOption] = useState(null);
  const [message, setMessage] = useState("");
  const [isSuccess, setIsSuccess] = useState(false);
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [locating, setLocating] = useState(false);
  // Spans the entire submit flow (GPS lookup + the POST itself), not just the
  // GPS wait. `locating` alone used to flip back to false as soon as
  // coordinates resolved, re-enabling the button while the POST was still
  // in flight - a fast double-tap or slow network could fire a second
  // request before the first one finished.
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    async function fetchQuiz() {
      try {
        const data = await apiFetch(`/shared/quiz/${id}`);
        setQuiz(data.quiz);
        setHasSubmitted(Boolean(data.quiz.attempted));
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    fetchQuiz();
  }, [id]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (selectedOption === null || submitting) return;

    setError("");
    setSubmitting(true);
    setLocating(true);
    try {
      // This is what enforces "on campus only": the request is rejected
      // server-side unless these coordinates fall inside the college geofence.
      const coords = await getLocation("answer this attendance question");
      setLocating(false);
      const data = await apiFetch(`/shared/student/quiz/${id}/answer`, {
        method: "POST",
        body: JSON.stringify({
          answerIndex: selectedOption,
          latitude: coords.latitude,
          longitude: coords.longitude,
          accuracy: coords.accuracy
        })
      });
      
      setMessage(data.message);
      setHasSubmitted(true);
      if (data.correct) {
        setIsSuccess(true);
      } else {
        setIsSuccess(false);
      }
    } catch (err) {
      setLocating(false);
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <div>Loading...</div>;
  if (error) return <div className="error-box">{error}</div>;
  if (!quiz) return <div>Quiz not found.</div>;

  return (
    <div className="dashboard-content">
      <div className="card" style={{ maxWidth: '600px', margin: '0 auto' }}>
        <h2>Attendance Question</h2>
        <p>Answer correctly to be marked present for <strong>{quiz.subjectName}</strong>.</p>
        <p style={{ display: "flex", alignItems: "center", gap: "6px", color: "#666", fontSize: "0.9rem" }}>
          <MapPin size={16} /> You must be on campus &mdash; your device's location is checked when you submit.
        </p>
        
        {message && (
          <div className={isSuccess ? "success-box" : "error-box"} style={{ margin: '1rem 0' }}>
            {message}
          </div>
        )}
        
        {!hasSubmitted && (
          <form onSubmit={handleSubmit} className="form-stack">
            <h3>{quiz.question}</h3>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', margin: '1rem 0' }}>
              {quiz.options.map((opt, i) => (
                <label key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px', border: '1px solid #ddd', borderRadius: '4px', cursor: 'pointer' }}>
                  <input 
                    type="radio" 
                    name="answer" 
                    value={i} 
                    checked={selectedOption === i}
                    onChange={() => setSelectedOption(i)}
                  />
                  <span>{opt}</span>
                </label>
              ))}
            </div>
            
            <button type="submit" className="primary-button full" disabled={selectedOption === null || submitting}>
              {locating ? "Checking your location..." : submitting ? "Submitting..." : "Submit Answer"}
            </button>
          </form>
        )}
        
        <div style={{ marginTop: '2rem', textAlign: 'center' }}>
          <button className="ghost-button" onClick={() => navigate("/student")}>
            Back to Dashboard
          </button>
        </div>
      </div>
    </div>
  );
}
