import assert from "node:assert/strict";
import { formatAssignmentDueDate, isAssignmentOverdue, isSubmissionLate } from "../client/src/utils/assignments.js";

const today = new Date(2026, 8, 23, 15, 30);
assert.equal(isAssignmentOverdue({ dueDate: "2026-09-23" }, today), false);
assert.equal(isAssignmentOverdue({ dueDate: "2026-09-22" }, today), true);
assert.equal(isSubmissionLate("2026-09-23T23:59:00+05:30", "2026-09-23"), false);
assert.equal(isSubmissionLate("2026-09-24T00:01:00", "2026-09-23"), true);
assert.match(formatAssignmentDueDate("2026-09-23"), /2026|23|09/);
console.log("assignment-date tests passed");
