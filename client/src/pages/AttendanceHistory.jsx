import React, { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Badge, EmptyState } from "../components/UI.jsx";
import { apiFetch } from "../context/api.js";
import { useAuth } from "../context/AuthContext.jsx";

export function AttendanceHistory() {
  const { user } = useAuth();
  const [records, setRecords] = useState([]);
  const [query, setQuery] = useState("");
  const [date, setDate] = useState("");

  useEffect(() => {
    apiFetch("/attendance").then((data) => setRecords(data.attendance));
  }, []);

  const filtered = useMemo(() => {
    return records.filter((item) => {
      const matchesSearch = [item.studentName, item.rollNumber, item.subjectName, item.subjectCode]
        .join(" ")
        .toLowerCase()
        .includes(query.toLowerCase());
      const matchesDate = !date || item.date === date;
      return matchesSearch && matchesDate;
    });
  }, [records, query, date]);

  return (
    <div className="page-stack">
      <section className="panel">
        <div className="section-heading">
          <div>
            <span className="eyebrow">{user.role === "admin" ? "All logs" : "My logs"}</span>
            <h2>Attendance history</h2>
          </div>
        </div>
        <div className="toolbar">
          <label className="search-field">
            <Search size={17} />
            <input placeholder="Search student, roll, or subject" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <input className="date-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        {filtered.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {user.role === "admin" && <th>Student</th>}
                  <th>Subject</th>
                  <th>Date</th>
                  <th>Time</th>
                  <th>Status</th>
                  <th>Method</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => (
                  <tr key={item.id}>
                    {user.role === "admin" && <td>{item.studentName}<span>{item.rollNumber}</span></td>}
                    <td>{item.subjectName}<span>{item.subjectCode}</span></td>
                    <td>{item.date}</td>
                    <td>{item.time}</td>
                    <td><Badge value={item.status} /></td>
                    <td>{item.method}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="No matching logs" text="Try changing the search or date filter." />
        )}
      </section>
    </div>
  );
}
