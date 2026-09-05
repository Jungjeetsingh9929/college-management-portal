import React, { useEffect, useState } from "react";
import { Calendar } from "lucide-react";
import { getUpcomingHolidays } from "../utils/dates.js";

export function YearSchedule() {
  const [holidays, setHolidays] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function fetchHolidays() {
      try {
        const res = await fetch("/api/shared/holidays", {
          headers: { Authorization: `Bearer ${localStorage.getItem("attendance_token")}` }
        });
        if (!res.ok) throw new Error("Failed to fetch year schedule.");
        const data = await res.json();
        
        // sort by date
        const sorted = data.holidays.sort((a, b) => new Date(a.date) - new Date(b.date));
        setHolidays(sorted);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    fetchHolidays();
  }, []);

  if (loading) return <div>Loading...</div>;
  if (error) return <div className="error-box">{error}</div>;

  const today = new Date();
  today.setHours(0,0,0,0);

  const upcomingHolidays = getUpcomingHolidays(holidays, 7);

  return (
    <div className="dashboard-content">
      {upcomingHolidays.length > 0 && (
        <div className="success-box" style={{ marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Calendar size={24} />
          <div>
            <strong>Reminder:</strong> {upcomingHolidays.length > 1 ? "The following holidays fall" : "A holiday falls"} in the next 7 days:{" "}
            {upcomingHolidays.map((h, i) => (
              <span key={h.id}>
                {i > 0 && ", "}
                <strong>{h.title}</strong> ({h.date})
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <h2>Academic Year Schedule</h2>
        <p>List of holidays and important dates for the academic year.</p>

        {holidays.length > 0 ? (
          <div className="table-responsive" style={{ marginTop: '20px' }}>
            <table>
              <thead>
                <tr>
                  <th>Event / Holiday</th>
                  <th>Date</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {holidays.map(h => {
                  const hDate = new Date(h.date);
                  const isPast = hDate < today;
                  const isToday = hDate.getTime() === today.getTime();
                  return (
                    <tr key={h.id} style={{ opacity: isPast ? 0.6 : 1 }}>
                      <td><strong>{h.title}</strong></td>
                      <td>{h.date}</td>
                      <td>
                        {isPast ? "Passed" : isToday ? <span style={{color: 'green'}}>Today</span> : "Upcoming"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p>No holidays found.</p>
        )}
      </div>
    </div>
  );
}
