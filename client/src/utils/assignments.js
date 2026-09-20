// Urgency ordering used to sort assignment lists: overdue first, then
// due-soon, then upcoming, then completed items last.
const STATUS_ORDER = { overdue: 0, "due-soon": 1, upcoming: 2, completed: 3 };

export function sortAssignmentsByUrgency(assignments) {
  return [...(assignments || [])].sort((a, b) => {
    const orderDiff = (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99);
    if (orderDiff !== 0) return orderDiff;
    return new Date(a.dueDate) - new Date(b.dueDate);
  });
}

export function groupAssignmentsByStatus(assignments) {
  const groups = { overdue: [], "due-soon": [], upcoming: [], completed: [] };
  for (const assignment of assignments || []) {
    (groups[assignment.status] || groups.upcoming).push(assignment);
  }
  for (const key of Object.keys(groups)) {
    groups[key].sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
  }
  return groups;
}
