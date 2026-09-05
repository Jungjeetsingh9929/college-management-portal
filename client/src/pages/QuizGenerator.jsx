import React, { useEffect, useState } from "react";
import { QrCode } from "lucide-react";

export function QuizGenerator() {
  const [quizzes, setQuizzes] = useState([]);
  const [classes, setClasses] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  
  const [form, setForm] = useState({ 
    className: "", 
    subjectId: "",
    question: "", 
    options: ["", "", "", ""], 
    correctAnswerIndex: 0 
  });
  const [message, setMessage] = useState("");

  useEffect(() => {
    async function fetchData() {
      try {
        const [quizRes, stuRes, subjRes] = await Promise.all([
          fetch("/api/faculty/quizzes", { headers: { Authorization: `Bearer ${localStorage.getItem("attendance_token")}` } }),
          fetch("/api/faculty/students", { headers: { Authorization: `Bearer ${localStorage.getItem("attendance_token")}` } }),
          fetch("/api/subjects", { headers: { Authorization: `Bearer ${localStorage.getItem("attendance_token")}` } })
        ]);
        
        if (!quizRes.ok || !stuRes.ok || !subjRes.ok) throw new Error("Failed to fetch data.");
        
        const quizData = await quizRes.json();
        const stuData = await stuRes.json();
        const subjData = await subjRes.json();
        
        setQuizzes(quizData.quizzes);
        setClasses(stuData.classes);
        setSubjects(subjData.subjects);
        
        if (stuData.classes.length > 0) {
          setForm(f => ({ ...f, className: stuData.classes[0] }));
        }
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  async function handleCreate(e) {
    e.preventDefault();
    setMessage("");
    setError("");
    try {
      const res = await fetch("/api/faculty/quizzes", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("attendance_token")}`
        },
        body: JSON.stringify(form)
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to create quiz");
      }
      const { quiz } = await res.json();
      setQuizzes(prev => [...prev, quiz]);
      setMessage("Quiz created successfully.");
      setForm({ ...form, question: "", options: ["", "", "", ""] });
    } catch (err) {
      setError(err.message);
    }
  }

  async function toggleActive(id) {
    try {
      const res = await fetch(`/api/faculty/quizzes/${id}/toggle`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${localStorage.getItem("attendance_token")}` }
      });
      if (res.ok) {
        const { quiz } = await res.json();
        setQuizzes(prev => prev.map(q => q.id === id ? quiz : q));
      }
    } catch (err) {
      alert("Failed to toggle");
    }
  }

  async function handleDelete(id) {
    try {
      const res = await fetch(`/api/faculty/quizzes/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${localStorage.getItem("attendance_token")}` }
      });
      if (res.ok) {
        setQuizzes(prev => prev.filter(q => q.id !== id));
      }
    } catch (err) {
      alert("Failed to delete");
    }
  }

  const handleOptionChange = (index, value) => {
    const newOptions = [...form.options];
    newOptions[index] = value;
    setForm({ ...form, options: newOptions });
  };

  if (loading) return <div>Loading...</div>;

  return (
    <div className="dashboard-content">
      <div className="card">
        <h2>Generate QR Attendance Quiz</h2>
        <p>Create a multiple-choice question for attendance.</p>
        {message && <div className="success-box">{message}</div>}
        {error && <div className="error-box">{error}</div>}
        
        <form onSubmit={handleCreate} className="form-stack">
          <label>
            Class
            <select value={form.className} onChange={e => setForm({...form, className: e.target.value})} required>
              {classes.map(cls => (
                <option key={cls} value={cls}>{cls}</option>
              ))}
            </select>
          </label>
          <label>
            Subject
            <select value={form.subjectId} onChange={e => setForm({...form, subjectId: e.target.value})} required>
              <option value="">Select subject</option>
              {subjects.filter(s => s.className === form.className).map(sub => (
                <option key={sub.id} value={sub.id}>{sub.subjectName} ({sub.code})</option>
              ))}
            </select>
          </label>
          <label>
            Question
            <input type="text" value={form.question} onChange={e => setForm({...form, question: e.target.value})} required />
          </label>
          
          <p>Options:</p>
          {form.options.map((opt, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <input type="radio" name="correct" checked={form.correctAnswerIndex === i} onChange={() => setForm({...form, correctAnswerIndex: i})} />
              <input type="text" value={opt} onChange={e => handleOptionChange(i, e.target.value)} required placeholder={`Option ${i+1}`} />
            </div>
          ))}

          <button type="submit" className="primary-button">Generate Link</button>
        </form>
      </div>

      <div className="card">
        <h2>Active Quizzes</h2>
        {quizzes.length > 0 ? (
          <ul>
            {quizzes.map(q => {
              const link = `${window.location.origin}/student/quiz/${q.id}`;
              const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(link)}`;
              return (
                <li key={q.id} style={{ marginBottom: '1rem', borderBottom: '1px solid #eee', paddingBottom: '1rem' }}>
                  <strong>{q.question}</strong> - Class: {q.className} <br/>
                  Status: {q.active ? <span style={{color: 'green'}}>Active</span> : <span style={{color: 'red'}}>Inactive</span>} <br/>
                  
                  <div style={{ margin: '10px 0', padding: '10px', background: '#f5f5f5', borderRadius: '4px' }}>
                    <p>Share this link on WhatsApp:</p>
                    <a href={link} target="_blank" rel="noreferrer" style={{ wordBreak: 'break-all' }}>{link}</a>
                  </div>
                  
                  <div style={{ margin: '10px 0' }}>
                    <p>Or scan QR Code:</p>
                    <img src={qrUrl} alt="QR Code" />
                  </div>
                  
                  <button className="primary-button" onClick={() => toggleActive(q.id)} style={{ marginRight: '10px' }}>
                    {q.active ? 'Deactivate' : 'Activate'}
                  </button>
                  <button className="ghost-button" onClick={() => handleDelete(q.id)}>Delete</button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p>You haven't generated any quizzes.</p>
        )}
      </div>
    </div>
  );
}
