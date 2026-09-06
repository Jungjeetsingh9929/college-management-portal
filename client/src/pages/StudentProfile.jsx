import React from "react";
import { Mail, Phone, UserRound } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";

export function StudentProfile() {
  const { user } = useAuth();
  const details = [
    ["Roll number", user.rollNumber],
    ["Class", user.className],
    ["Department", user.department],
    ["Graduation year", user.graduationYear || "-"],
    ["Approval status", user.approvalStatus || "approved"],
    ["Guardian", user.guardian || "-"]
  ];

  return (
    <div className="page-stack">
      <section className="profile-hero panel">
        <div className="avatar-lg">
          <UserRound size={42} />
        </div>
        <div>
          <span className="eyebrow">Student profile</span>
          <h2>{user.name}</h2>
          <p>{user.rollNumber} · {user.department}</p>
        </div>
      </section>
      <section className="profile-grid">
        <article className="panel">
          <h2>Academic details</h2>
          <div className="detail-list">
            {details.map(([label, value]) => (
              <div key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
            <p className="helper-text">Approval status is managed by the administration and cannot be edited by students. Need an update? <Link to="/complaints">Contact the administration through Complaints.</Link></p>
          </div>
        </article>
        <article className="panel">
          <h2>Contact</h2>
          <div className="contact-row"><Mail size={18} /> {user.email}</div>
          <div className="contact-row"><Phone size={18} /> {user.phone || "-"}</div>
        </article>
      </section>
    </div>
  );
}
