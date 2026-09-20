import React from "react";

const STATUS_LABELS = { none: "Not started", draft: "Draft", published: "Published", locked: "Locked" };

// Status of a subject's mark sheet: none -> draft -> published -> locked.
export function SheetStatusBadge({ status }) {
  return <span className={`badge sheet-${status}`}>{STATUS_LABELS[status] || status}</span>;
}

// A grade chip. F (including an absent student) is styled as a fail.
export function GradeBadge({ grade, absent = false }) {
  return <span className={`badge ${grade === "F" ? "grade-fail" : "grade-pass"}`}>{grade}{absent ? " (AB)" : ""}</span>;
}
