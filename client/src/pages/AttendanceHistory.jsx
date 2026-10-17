import React, { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Badge, EmptyState, Modal, useToast } from "../components/UI.jsx";
import { apiFetch } from "../context/api.js";
import { useAuth } from "../context/AuthContext.jsx";

const CORRECTION_STATUSES = ["present", "absent", "late", "excused"];
const blankCorrectionForm = { requestedStatus: "present", reason: "" };

export function AttendanceHistory() {
  const { user } = useAuth();
  const { showToast } = useToast() || {};
  const [records, setRecords] = useState([]);
  const [query, setQuery] = useState("");
  const [date, setDate] = useState("");
  const [correctionTarget, setCorrectionTarget] = useState(null);
  const [correctionForm, setCorrectionForm] = useState(blankCorrectionForm);
  const [submittingCorrection, setSubmittingCorrection] = useState(false);

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

  function openCorrectionModal(record) {
    setCorrectionTarget(record);
    setCorrectionForm({ requestedStatus: record.status, reason: "" });
  }

  async function submitCorrection(event) {
    event.preventDefault();
    if (!correctionTarget) return;
    setSubmittingCorrection(true);
    try {
      await apiFetch("/attendance/corrections", {
        method: "POST",
        body: JSON.stringify({
          attendanceId: correctionTarget.id,
          requestedStatus: correctionForm.requestedStatus,
          reason: correctionForm.reason
        })
      });
      showToast?.("Correction request submitted for review.", "success");
      setCorrectionTarget(null);
      setCorrectionForm(blankCorrectionForm);
    } catch (error) {
      showToast?.(error.message, "error");
    } finally {
      setSubmittingCorrection(false);
    }
  }

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
                  {user.role === "student" && <th></th>}
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
                    {user.role === "student" && (
                      <td>
                        <button className="link-button" type="button" onClick={() => openCorrectionModal(item)}>
                          Request correction
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="No matching logs" text="Try changing the search or date filter." />
        )}
      </section>
      <Modal
        open={Boolean(correctionTarget)}
        onClose={() => { setCorrectionTarget(null); setCorrectionForm(blankCorrectionForm); }}
        title="Request attendance correction"
        description={correctionTarget ? `${correctionTarget.subjectName} on ${correctionTarget.date} - currently marked ${correctionTarget.status}.` : ""}
      >
        <form className="admin-form" onSubmit={submitCorrection}>
          <label>
            Requested status
            <select
              value={correctionForm.requestedStatus}
              onChange={(e) => setCorrectionForm((current) => ({ ...current, requestedStatus: e.target.value }))}
            >
              {CORRECTION_STATUSES.map((status) => (
                <option key={status} value={status}>{status}</option>
              ))}
            </select>
          </label>
          <label>
            Reason
            <textarea
              required
              maxLength={500}
              rows={3}
              value={correctionForm.reason}
              onChange={(e) => setCorrectionForm((current) => ({ ...current, reason: e.target.value }))}
              placeholder="Explain why this record should be corrected."
            />
          </label>
          <button className="primary-button" type="submit" disabled={submittingCorrection}>
            {submittingCorrection ? "Submitting..." : "Submit request"}
          </button>
          <button className="secondary-button" type="button" onClick={() => { setCorrectionTarget(null); setCorrectionForm(blankCorrectionForm); }}>
            Cancel
          </button>
        </form>
      </Modal>
    </div>
  );
}
