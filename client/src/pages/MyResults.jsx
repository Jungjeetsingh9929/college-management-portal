import React, { useEffect, useState } from "react";
import { Award, GraduationCap, Lock } from "lucide-react";
import { EmptyState, StatCard } from "../components/UI.jsx";
import { GradeBadge } from "../components/MarksBadges.jsx";
import { apiFetch } from "../context/api.js";

const show = (value) => (value === null || value === undefined ? "—" : value);
const gpa = (value) => (value === null || value === undefined ? "—" : Number(value).toFixed(2));

export function MyResults() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    apiFetch("/marks/me").then(setData).catch((err) => setError(err.message));
  }, []);

  if (error) return <div role="alert" className="error-box">{error}</div>;
  if (!data) return <div className="panel"><p>Loading results…</p></div>;

  const latest = data.semesters[data.semesters.length - 1];
  return (
    <div className="page-stack">
      <section className="stats-grid">
        <StatCard label="CGPA" value={gpa(data.cgpa)} hint={`Out of ${data.gradeScale[0].points}`} tone="green" icon={Award} />
        <StatCard label={latest ? `SGPA · Semester ${latest.semester}` : "Latest SGPA"} value={gpa(latest?.sgpa)} hint="Most recent published semester" tone="blue" icon={GraduationCap} />
        <StatCard label="Credits earned" value={data.creditsEarned} hint={`of ${data.totalCredits} attempted`} tone="blue" />
        <StatCard label="Semesters" value={data.semesters.length} hint="With published results" tone="amber" />
      </section>

      {data.semesters.length === 0 && (
        <section className="panel">
          <EmptyState title="No results published yet" text="Your semester results, SGPA and CGPA appear here once your teachers publish marks." />
        </section>
      )}

      {[...data.semesters].reverse().map((semester) => (
        <section className="panel" key={semester.semester}>
          <div className="section-heading">
            <div>
              <span className="eyebrow">Semester {semester.semester}</span>
              <h2>SGPA {gpa(semester.sgpa)}</h2>
            </div>
            <span className="muted-text">{semester.creditsEarned}/{semester.credits} credits earned</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Subject</th><th>Credits</th><th>Internal</th><th>End-sem</th><th>Total</th><th>Grade</th><th>Points</th></tr>
              </thead>
              <tbody>
                {semester.subjects.map((item) => (
                  <tr key={item.id}>
                    <td>{item.subjectName}<span>{item.code}{item.countsTowardGpa ? "" : " · not counted in GPA"}</span></td>
                    <td>{item.credits}</td>
                    <td>{show(item.internalMarks)}/{item.internalMax}</td>
                    <td>{item.absent ? "AB" : `${show(item.endSemMarks)}/${item.endSemMax}`}</td>
                    <td>{item.totalMarks}/{item.totalMax}<span>{item.percentage}%</span></td>
                    <td><GradeBadge grade={item.grade} absent={item.absent} />{item.locked && <span className="marks-final"><Lock size={11} /> Final</span>}</td>
                    <td>{item.gradePoints}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      <section className="panel">
        <div className="section-heading"><div><span className="eyebrow">Reference</span><h2>Grade scale</h2></div></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Grade</th><th>Meaning</th><th>Percentage</th><th>Grade points</th></tr></thead>
            <tbody>
              {data.gradeScale.map((band, index) => (
                <tr key={band.grade}>
                  <td><GradeBadge grade={band.grade} /></td>
                  <td>{band.label}</td>
                  <td>{index === 0 ? `${band.min}% and above` : band.grade === "F" ? `Below ${data.passPercentage}%` : `${band.min}% to under ${data.gradeScale[index - 1].min}%`}</td>
                  <td>{band.points}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted-text">SGPA = Σ(credits × grade points) ÷ Σ credits for a semester; CGPA uses every published semester. Subjects with 0 credits are shown but not counted. A student absent from the end-semester exam receives F.</p>
      </section>
    </div>
  );
}
