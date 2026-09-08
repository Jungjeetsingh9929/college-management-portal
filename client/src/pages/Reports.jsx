import React, { useEffect, useMemo, useState } from "react";
import { Download, FileText, Search } from "lucide-react";
import { Badge, EmptyState } from "../components/UI.jsx";
import { apiDownload, apiFetch, reportUrl } from "../context/api.js";

export function Reports() {
  const [records, setRecords] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [students, setStudents] = useState([]);
  const [query, setQuery] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([apiFetch("/attendance"), apiFetch("/subjects"), apiFetch("/students")]).then(([attendance, subjectData, studentData]) => {
      setRecords(attendance.attendance);
      setSubjects(subjectData.subjects);
      setStudents(studentData.students);
    });
  }, []);

  const filtered = useMemo(() => {
    return records.filter((item) => {
      const matchesSearch = [item.studentName, item.rollNumber, item.subjectName]
        .join(" ")
        .toLowerCase()
        .includes(query.toLowerCase());
      const matchesSubject = !subjectId || item.subjectId === subjectId;
      return matchesSearch && matchesSubject;
    });
  }, [records, query, subjectId]);

  async function download(type) {
    const url = subjectId ? `${reportUrl(type)}?subjectId=${subjectId}` : reportUrl(type);
    setError("");
    try {
      const blob = await apiDownload(url);
      const urlObj = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = urlObj;
      anchor.download = `attendance-report.${type}`;
      anchor.click();
      URL.revokeObjectURL(urlObj);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="page-stack">
      <section className="stats-grid">
        <div className="stat-card blue"><span>Report records</span><strong>{filtered.length}</strong><small>After filters</small></div>
        <div className="stat-card green"><span>Students</span><strong>{students.length}</strong><small>Export scope</small></div>
        <div className="stat-card amber"><span>Subjects</span><strong>{subjects.length}</strong><small>Active courses</small></div>
      </section>
      <section className="panel">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Reports</span>
            <h2>Export attendance</h2>
          </div>
          <div className="action-row">
            <button className="secondary-button" onClick={() => download("csv")}>
              <Download size={17} />
              CSV
            </button>
            <button className="primary-button" onClick={() => download("pdf")}>
              <FileText size={17} />
              PDF
            </button>
          </div>
        </div>
        {error && <div role="alert" className="error-box">{error}</div>}
        <div className="toolbar">
          <label className="search-field">
            <Search size={17} />
            <input placeholder="Search report records" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <select value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
            <option value="">All subjects</option>
            {subjects.map((subject) => (
              <option key={subject.id} value={subject.id}>{subject.subjectName}</option>
            ))}
          </select>
        </div>
        {filtered.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Subject</th>
                  <th>Date</th>
                  <th>Status</th>
                  <th>Method</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => (
                  <tr key={item.id}>
                    <td>{item.studentName}<span>{item.rollNumber}</span></td>
                    <td>{item.subjectName}<span>{item.subjectCode}</span></td>
                    <td>{item.date} <span>{item.time}</span></td>
                    <td><Badge value={item.status} /></td>
                    <td>{item.method}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="No report rows" text="Try another subject or search term." />
        )}
      </section>
    </div>
  );
}
