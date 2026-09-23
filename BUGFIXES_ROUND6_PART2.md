# Round 6 — Class-change guard on assignments (fix #4 from Audit Round 6)

Scope: implements finding #4 from `AUDIT_ROUND_6_REPORT.md` — a teacher could
change an assignment's `className` after students had already submitted
work, which silently orphaned those submissions (not deleted, just
unreachable through the UI/API, since both `GET
/faculty/assignments/:id/submissions` and `GET /student/assignments` filter
strictly by the assignment's *current* `className`).

`npm install`/`npm test` could not be run in this sandbox (no network, no
`node_modules`). The touched file was checked with `node --check`, and the
client (`FacultyAssignments.jsx`) was read to confirm it already surfaces any
`message` field from a failed `PUT` via `err.message` — no client change
needed for the new error to display.

## Fix #4 — `PUT /faculty/assignments/:id`

Mirrors the existing guard in `subjects.js` (which blocks a `className` edit
once marks exist for that subject): if the submitted `className` differs
from the assignment's current one, and any `assignmentCompletions` row
already exists for that assignment, the update is now rejected with
`409` and a message telling the teacher to delete or move the submissions
first, instead of silently applying the change:

```js
db.assignmentCompletions ||= [];
if (className !== assignment.className && db.assignmentCompletions.some((item) => item.assignmentId === assignment.id)) {
  return res.status(409).json({ message: "Students have already submitted work for this assignment. Delete or move their submissions before changing the class." });
}
```

This only blocks *changing* the class — editing title/description/dueDate,
or saving the form with the class unchanged, is unaffected. A teacher who
genuinely needs to move the assignment can still delete it (which now also
cleans up its blobs, per the round's earlier fix) and recreate it for the
new class.

## Not touched in this round

Findings #5 (filename sanitization), #6 (GPS self-report, a flagged
discussion item), #7 (cross-student device-fingerprint check), and #8 (stale
HOD status on the client) are unchanged — next rounds, per the audit's
suggested order.
