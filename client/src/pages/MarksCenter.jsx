import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Award, Download, Eye, Lock, NotebookPen, Search } from "lucide-react";
import { EmptyState, StatCard } from "../components/UI.jsx";
import { SheetStatusBadge } from "../components/MarksBadges.jsx";
import { apiFetch, downloadToFile } from "../context/api.js";
import { useAuth } from "../context/AuthContext.jsx";

const STATUS_LABELS = { none: "Not started", draft: "Draft", published: "Published", locked: "Locked" };
const ROLE_LABELS = { admin: "Admin", teacher: "Your subject", hod: "Department oversight" };

export function MarksCenter() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState({ subjects: [], counts: { none: 0, draft: 0, published: 0, locked: 0 }, classes: [], total: 0 });
  const [filters, setFilters] = useState({ className: "", semester: "", status: "", q: "" });
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [exportSemester, setExportSemester] = useState("");
  const canExport = user?.role === "admin" || user?.isHod;

  useEffect(() => {
    const timer = window.setTimeout(() => setFilters((old) => (old.q === query ? old : { ...old, q: query })), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => value && params.set(key, value));
    apiFetch(`/marks/subjects?${params.toString()}`)
      .then((result) => { if (!cancelled) { setData(result); setError(""); } })
      .catch((err) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [filters]);

  function setFilter(key, value) {
    setFilters((old) => ({ ...old, [key]: value }));
  }

  return (
    <div className="page-stack">
      <section className="stats-grid">
        <StatCard label="Not started" value={data.counts.none} hint="No marks saved yet" tone="blue" icon={NotebookPen} />
        <StatCard label="Draft" value={data.counts.draft} hint="Being entered" tone="amber" />
        <StatCard label="Published" value={data.counts.published} hint="Visible to students" tone="green" icon={Eye} />
        <StatCard label="Locked" value={data.counts.locked} hint="Final" tone="blue" icon={Lock} />
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Assessment</span>
            <h2>Marks &amp; results</h2>
          </div>
          <Award size={22} />
        </div>
        <div className="marks-bar">
          <label>
            Search
            <span className="marks-search"><Search size={14} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Subject, code, class or teacher" maxLength={80} /></span>
          </label>
          <label>
            Class
            <select value={filters.className} onChange={(e) => setFilter("className", e.target.value)}>
              <option value="">All classes</option>
              {data.classes.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <label>
            Semester
            <select value={filters.semester} onChange={(e) => setFilter("semester", e.target.value)}>
              <option value="">All semesters</option>
              {Array.from({ length: 12 }, (_, index) => <option key={index + 1} value={String(index + 1)}>Semester {index + 1}</option>)}
            </select>
          </label>
          <label>
            Status
            <select value={filters.status} onChange={(e) => setFilter("status", e.target.value)}>
              <option value="">Any status</option>
              {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
        </div>
        {error && <div role="alert" className="error-box">{error}</div>}
        {loading ? (
          <p>Loading subjects…</p>
        ) : data.subjects.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Subject</th><th>Class</th><th>Sem · Credits</th><th>Teacher</th><th>Entered</th><th>Status</th><th></th></tr>
              </thead>
              <tbody>
                {data.subjects.map((subject) => (
                  <tr key={subject.id}>
                    <td>{subject.subjectName}<span>{subject.code}</span></td>
                    <td>{subject.className}<span>{ROLE_LABELS[subject.role]}</span></td>
                    <td>
                      {subject.semester ? `Sem ${subject.semester}` : <span className="marks-warn">No semester</span>}
                      <span>{subject.credits === null ? <span className="marks-warn">No credits</span> : `${subject.credits} credit${subject.credits === 1 ? "" : "s"}`}</span>
                    </td>
                    <td>{subject.teacher}</td>
                    <td>{subject.completeCount}/{subject.studentCount}</td>
                    <td><SheetStatusBadge status={subject.sheetStatus} /></td>
                    <td><button className="secondary-button small" type="button" onClick={() => navigate(`/marks/${subject.id}`)}>{subject.role === "hod" ? "Review" : "Open"}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.total > data.subjects.length && <p className="muted-text">Showing the first {data.subjects.length} of {data.total} subjects. Narrow the filters to see the rest.</p>}
          </div>
        ) : (
          <EmptyState title="No subjects to show" text={user?.role === "teacher" ? "Subjects appear here when your teacher code is listed on the subject (Subjects page). Ask an admin if one is missing." : "No subjects match these filters."} />
        )}
      </section>

      {canExport && (
        <section className="panel">
          <div className="section-heading">
            <div>
              <span className="eyebrow">{user?.role === "admin" ? "All departments" : "Your department"}</span>
              <h2>Export results</h2>
            </div>
            <Download size={20} />
          </div>
          <div className="marks-bar">
            <label>
              Semester (for the SGPA summary)
              <select value={exportSemester} onChange={(e) => setExportSemester(e.target.value)}>
                <option value="">Choose…</option>
                {Array.from({ length: 12 }, (_, index) => <option key={index + 1} value={String(index + 1)}>Semester {index + 1}</option>)}
              </select>
            </label>
            <button className="secondary-button" type="button" onClick={() => downloadToFile(`/marks/export.csv${filters.className ? `?className=${encodeURIComponent(filters.className)}` : ""}`, "results.csv").catch(() => {})}>
              <Download size={15} /> Subject-wise results{filters.className ? ` (${filters.className})` : ""}
            </button>
            <button className="secondary-button" type="button" disabled={!exportSemester} onClick={() => downloadToFile(`/marks/export.csv?view=summary&semester=${exportSemester}${filters.className ? `&className=${encodeURIComponent(filters.className)}` : ""}`, `sgpa-semester-${exportSemester}.csv`).catch(() => {})}>
              <Download size={15} /> SGPA / CGPA summary
            </button>
          </div>
          <p className="muted-text">Only published and locked results are exported.</p>
        </section>
      )}
    </div>
  );
}
