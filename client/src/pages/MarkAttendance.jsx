import React, { useEffect, useState } from "react";
import { CheckCircle2, ClipboardCheck, Loader2, XCircle } from "lucide-react";
import { apiFetch } from "../context/api.js";
import { useAuth } from "../context/AuthContext.jsx";
import { Badge, EmptyState } from "../components/UI.jsx";

// Staff-only manual attendance marking. Replaces the old student GPS
// self-check-in: now a teacher (for their own classes) or an admin (for any
// class) picks a subject and marks each student present or absent.
export function MarkAttendance() {
  const { user } = useAuth();
  const [subjects, setSubjects] = useState([]);
  const [subjectId, setSubjectId] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [roster, setRoster] = useState(null);
  const [loadingSubjects, setLoadingSubjects] = useState(true);
  const [loadingRoster, setLoadingRoster] = useState(false);
  const [updatingId, setUpdatingId] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadSubjects() {
      try {
        if (user.role === "teacher") {
          const [subjectData, facultyData] = await Promise.all([
            apiFetch("/subjects"),
            apiFetch("/faculty/students")
          ]);
          const classesTaught = facultyData.classes || [];
          const list = subjectData.subjects.filter((subject) => classesTaught.includes(subject.className));
          setSubjects(list);
          if (list.length) setSubjectId(list[0].id);
        } else {
          const subjectData = await apiFetch("/subjects");
          setSubjects(subjectData.subjects);
          if (subjectData.subjects.length) setSubjectId(subjectData.subjects[0].id);
        }
      } catch (err) {
        setError(err.message);
      } finally {
        setLoadingSubjects(false);
      }
    }
    loadSubjects();
  }, [user.role]);

  async function loadRoster() {
    if (!subjectId) return;
    setLoadingRoster(true);
    setError("");
    try {
      const data = await apiFetch(`/attendance/roster?subjectId=${subjectId}&date=${date}`);
      setRoster(data);
    } catch (err) {
      setError(err.message);
      setRoster(null);
    } finally {
      setLoadingRoster(false);
    }
  }

  useEffect(() => {
    loadRoster();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subjectId, date]);

  async function markStudent(studentId, status) {
    setUpdatingId(studentId);
    setError("");
    try {
      await apiFetch("/attendance/mark", {
        method: "POST",
        body: JSON.stringify({ studentId, subjectId, status, date })
      });
      await loadRoster();
    } catch (err) {
      setError(err.message);
    } finally {
      setUpdatingId(null);
    }
  }

  return (
    <div className="page-stack">
      <section className="panel">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Staff only</span>
            <h2>Mark attendance</h2>
          </div>
          <ClipboardCheck size={22} />
        </div>
        <p style={{ margin: "0 0 12px", color: "#666", fontSize: "0.9rem" }}>
          Pick a subject and date, then mark each student present or absent. Students can no longer
          check themselves in.
        </p>

        {loadingSubjects ? (
          <p>Loading subjects...</p>
        ) : subjects.length ? (
          <div className="form-stack" style={{ maxWidth: 480 }}>
            <label>
              Subject
              <select value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
                {subjects.map((subject) => (
                  <option key={subject.id} value={subject.id}>
                    {subject.subjectName} ({subject.code}) · {subject.className}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Date
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
          </div>
        ) : (
          <EmptyState
            title="No subjects available"
            text={user.role === "teacher" ? "You aren't assigned to any subjects yet." : "No subjects have been set up yet."}
          />
        )}

        {error && (
          <div className="warning-banner" style={{ marginTop: 12 }}>
            <XCircle size={18} />
            <span>{error}</span>
          </div>
        )}
      </section>

      {subjects.length > 0 && (
        <section className="panel">
          <div className="section-heading">
            <div>
              <span className="eyebrow">{roster?.date || date}</span>
              <h2>{roster?.subject ? `${roster.subject.subjectName} · ${roster.subject.className}` : "Roster"}</h2>
            </div>
          </div>
          {loadingRoster ? (
            <p>Loading roster...</p>
          ) : roster?.roster?.length ? (
            <div className="list-stack">
              {roster.roster.map((student) => (
                <div className="list-row" key={student.studentId}>
                  <div>
                    <strong>{student.name}</strong>
                    <span>{student.rollNumber}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {student.status && <Badge value={student.status} />}
                    <button
                      className="primary-button small"
                      disabled={updatingId === student.studentId}
                      onClick={() => markStudent(student.studentId, "present")}
                    >
                      {updatingId === student.studentId ? (
                        <Loader2 size={14} className="spin" />
                      ) : (
                        <>
                          <CheckCircle2 size={14} /> Present
                        </>
                      )}
                    </button>
                    <button
                      className="ghost-button small"
                      disabled={updatingId === student.studentId}
                      onClick={() => markStudent(student.studentId, "absent")}
                    >
                      <XCircle size={14} /> Absent
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="No students found" text="There are no students in this class yet." />
          )}
        </section>
      )}
    </div>
  );
}
