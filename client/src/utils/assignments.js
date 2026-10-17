// Urgency ordering used to sort assignment lists: overdue first, then
// due-soon, then upcoming, then turned-in items ("completed" and "late" —
// a late turn-in is still turned in, just flagged) last.
const STATUS_ORDER = { overdue: 0, "due-soon": 1, upcoming: 2, completed: 3, late: 3 };

export function sortAssignmentsByUrgency(assignments) {
  return [...(assignments || [])].sort((a, b) => {
    const orderDiff = (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99);
    if (orderDiff !== 0) return orderDiff;
    return new Date(a.dueDate) - new Date(b.dueDate);
  });
}

// "late" assignments are grouped into the same "completed" bucket as
// on-time ones (they've been turned in) — assignment.status stays "late" on
// the individual item so the row can still show a distinct badge for it.
export function groupAssignmentsByStatus(assignments) {
  const groups = { overdue: [], "due-soon": [], upcoming: [], completed: [] };
  for (const assignment of assignments || []) {
    const bucket = assignment.status === "late" ? "completed" : assignment.status;
    (groups[bucket] || groups.upcoming).push(assignment);
  }
  for (const key of Object.keys(groups)) {
    groups[key].sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
  }
  return groups;
}

// Due dates are calendar dates, not instants. Treat an assignment as overdue
// only after the local calendar day has ended so dashboard and list status
// remain consistent throughout the due date.
export function isAssignmentOverdue(assignment, now = new Date()) {
  const dueDate = String(assignment?.dueDate || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return false;
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return dueDate < today;
}

export function formatAssignmentDueDate(value) {
  const dueDate = String(value || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return String(value || "—");
  return new Date(`${dueDate}T00:00:00`).toLocaleDateString();
}

export function isSubmissionLate(completedAt, dueDate) {
  const submitted = new Date(completedAt);
  const due = String(dueDate || "").slice(0, 10);
  if (!Number.isFinite(submitted.getTime()) || !/^\d{4}-\d{2}-\d{2}$/.test(due)) return false;
  const submittedDay = `${submitted.getFullYear()}-${String(submitted.getMonth() + 1).padStart(2, "0")}-${String(submitted.getDate()).padStart(2, "0")}`;
  return submittedDay > due;
}
