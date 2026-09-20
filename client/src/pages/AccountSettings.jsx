import React from "react";
import { KeyRound, Mail, UserRound } from "lucide-react";
import { useAuth } from "../context/AuthContext.jsx";
import { ChangePassword } from "../components/ChangePassword.jsx";
import { SessionManagement } from "../components/SessionManagement.jsx";

export function AccountSettings() {
  const { user } = useAuth();

  return (
    <div className="page-stack">
      <section className="profile-hero panel">
        <div className="avatar-lg">
          <UserRound size={42} />
        </div>
        <div>
          <span className="eyebrow">Account settings</span>
          <h2>{user?.name}</h2>
          <p>{user?.email}</p>
        </div>
      </section>
      <section className="profile-grid">
        <article className="panel">
          <h2>Account</h2>
          <div className="contact-row"><Mail size={18} /> {user?.email}</div>
          <div className="contact-row"><KeyRound size={18} /> Role: {user?.role}</div>
        </article>
        <ChangePassword />
      </section>
      <SessionManagement />
    </div>
  );
}
