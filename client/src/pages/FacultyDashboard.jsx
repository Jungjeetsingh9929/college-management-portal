import React, { useEffect, useState } from "react";
import { Calendar } from "lucide-react";
import { useAuth } from "../context/AuthContext.jsx";
import { getUpcomingHolidays } from "../utils/dates.js";

export function FacultyDashboard() {
  const { user } = useAuth();
  const [students, setStudents] = useState([]);
  const [classes, setClasses] = useState([]);
  const [holidays, setHolidays] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function fetchData() {
      try {
        const [stuRes, holRes] = await Promise.all([
          fetch("/api/faculty/students", {
            headers: { Authorization: `Bearer ${localStorage.getItem("attendance_token")}` }
          }),
          fetch("/api/shared/holidays", {
            headers: { Authorization: `Bearer ${localStorage.getItem("attendance_token")}` }
          })
        ]);
        if (!stuRes.ok) throw new Error("Failed to fetch students.");
        const data = await stuRes.json();
        setStudents(data.students);
        setClasses(data.classes);
        if (holRes.ok) {
          const holData = await holRes.json();
          setHolidays(holData.holidays || []);
        }
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  if (loading) return <div>Loading dashboard...</div>;
  if (error) return <div className="error-box">{error}</div>;

  const upcomingHolidays = getUpcomingHolidays(holidays, 7);

  return (
    <div className="dashboard-content">
      {upcomingHolidays.length > 0 && (
        <div className="success-box" style={{ marginBottom: '1rem' }}>
          <Calendar size={18} />
          <div>
            <strong>Upcoming:</strong>{" "}
            {upcomingHolidays.map((h) => `${h.title} (${h.date})`).join(", ")}
          </div>
        </div>
      )}
      <div className="card">
        <h2>Welcome, {user.name}</h2>
        <p>Department: {user.department}</p>
      </div>

      <div className="card">
        <h3>Classes Taught</h3>
        {classes.length > 0 ? (
          <ul>
            {classes.map(cls => <li key={cls}>{cls}</li>)}
          </ul>
        ) : (
          <p>No classes assigned.</p>
        )}
      </div>

      <div className="card">
        <h3>Students Overview</h3>
        {students.length > 0 ? (
          <div className="table-responsive">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Roll No</th>
                  <th>Class</th>
                  <th>Email</th>
                </tr>
              </thead>
              <tbody>
                {students.map(student => (
                  <tr key={student.id}>
                    <td>{student.name}</td>
                    <td>{student.rollNumber}</td>
                    <td>{student.className}</td>
                    <td>{student.email}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>No students found for your classes.</p>
        )}
      </div>
    </div>
  );
}
