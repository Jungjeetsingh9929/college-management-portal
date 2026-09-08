import React, { useEffect, useMemo, useState } from "react";
import { Search, UsersRound } from "lucide-react";
import { Badge, EmptyState } from "../components/UI.jsx";
import { apiFetch } from "../context/api.js";
import { useAuth } from "../context/AuthContext.jsx";

export function StudentRecords() {
  const { user } = useAuth();
  const [records, setRecords] = useState([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    apiFetch("/students")
      .then((data) => setRecords(data.students || []))
      .catch((err) => setError(err.message));
  }, []);

  const filtered = useMemo(() => records.filter((record) => {
    const text = [record.name, record.rollNumber, record.email, record.className, record.department]
      .join(" ").toLowerCase();
    return text.includes(query.toLowerCase()) && (!status || record.approvalStatus === status);
  }), [records, query, status]);

  return (
    <div className="page-stack">
      <section className="panel">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Student account</span>
            <h2>{user?.role === "student" ? "My Student Record" : "Student List"}</h2>
          </div>
          <UsersRound size={22} />
        </div>
        <p className="helper-text">{user?.role === "student" ? "View your own student record and approval status. Other students’ records are not visible to you." : "Search student records and filter by approval status."}</p>
        <div className="toolbar">
          <label className="search-field">
            <Search size={17} />
            <input aria-label={user?.role === "student" ? "Search my student record" : "Search student records"} placeholder={user?.role === "student" ? "Search your record" : "Search name, roll number, or class"} value={query} onChange={(event) => setQuery(event.target.value)} />
          </label>
          <label>
            Status
            <select aria-label="Filter student records by status" value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">All statuses</option>
              <option value="approved">Approved</option>
              <option value="pending">Pending</option>
              <option value="rejected">Rejected</option>
            </select>
          </label>
        </div>
        {error && <div role="alert" className="error-box">{error}</div>}
        {filtered.length ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Name</th><th>Roll number</th><th>Class</th><th>Department</th><th>Status</th></tr></thead>
              <tbody>{filtered.map((record) => (
                <tr key={record.id}>
                  <td>{record.name}<span>{record.email}</span></td>
                  <td>{record.rollNumber}</td>
                  <td>{record.className}</td>
                  <td>{record.department}</td>
                  <td><Badge value={record.approvalStatus || "approved"} /></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="No matching student records" text="Try another search term or status filter." />
        )}
      </section>
    </div>
  );
}
