import React from "react";

export function StatCard({ label, value, hint, tone = "blue" }) {
  return (
    <article className={`stat-card ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {hint && <small>{hint}</small>}
    </article>
  );
}

export function Badge({ value }) {
  const normalized = String(value).toLowerCase();
  return <span className={`badge ${normalized}`}>{value}</span>;
}

export function EmptyState({ title, text }) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      <p>{text}</p>
    </div>
  );
}

export function ProgressBar({ value }) {
  return (
    <div className="progress-track" aria-label={`${value}%`}>
      <span style={{ width: `${Math.min(value, 100)}%` }} />
    </div>
  );
}
