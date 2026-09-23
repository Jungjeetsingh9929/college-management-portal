// Dependency-free tests for accessService's teacher/class resolution.
// Regression coverage for a bug where teachers could not select certain
// classes (in Assignments/Notices/Notes/Attendance/Quiz creation) because
// classesTaughtByTeacher() failed to recognize schedule "teacher" entries
// that carried lab/zone annotations, e.g. "AGA(LAB-2)", or the "::"
// co-teaching separator, e.g. "DCE :: AGA(LAB-2)".
import assert from "node:assert/strict";
import { classesTaughtByTeacher, scheduleBelongsToTeacher, teacherCodes } from "../server/services/accessService.js";

// ---- teacherCodes: plain delimiters still work ----
assert.deepEqual(teacherCodes("AGA"), ["aga"]);
assert.deepEqual(teacherCodes("AYV, LRG"), ["ayv", "lrg"]);
assert.deepEqual(teacherCodes("DCE/SSR/SYN"), ["dce", "ssr", "syn"]);
assert.deepEqual(teacherCodes("AKJ and BCE"), ["akj", "bce"]);
assert.deepEqual(teacherCodes(""), []);
assert.deepEqual(teacherCodes(null), []);

// ---- teacherCodes: parenthetical lab/zone annotations are stripped ----
assert.deepEqual(teacherCodes("AGA(LAB-2)"), ["aga"]);
assert.deepEqual(teacherCodes("SBE (LAB-5)"), ["sbe"]);
assert.deepEqual(teacherCodes("AKT(Zone 4)"), ["akt"]);
assert.deepEqual(teacherCodes("SBK(ZONE-2)"), ["sbk"]);

// ---- teacherCodes: "::" co-teaching separator is split ----
assert.deepEqual(teacherCodes("DCE :: AGA(LAB-2)"), ["dce", "aga"]);
assert.deepEqual(teacherCodes("AYV, LRG :: SBK(ZONE-2)"), ["ayv", "lrg", "sbk"]);

// ---- scheduleBelongsToTeacher honors the same parsing ----
assert.equal(scheduleBelongsToTeacher({ teacher: "AGA(LAB-2)" }, "AGA"), true);
assert.equal(scheduleBelongsToTeacher({ teacher: "AGA(LAB-2)" }, "aga"), true);
assert.equal(scheduleBelongsToTeacher({ teacher: "DCE :: AGA(LAB-2)" }, "DCE"), true);
assert.equal(scheduleBelongsToTeacher({ teacher: "DCE :: AGA(LAB-2)" }, "AGA"), true);
assert.equal(scheduleBelongsToTeacher({ teacher: "AGA(LAB-2)" }, "LAB-2"), false);

// ---- classesTaughtByTeacher: annotated/combined entries are not dropped ----
const db = {
  schedules: [
    { section: "CSE3-A", teacher: "AKT(Zone 4)" },
    { section: "CSE3-B", teacher: "AKT(Zone 4)" },
    { section: "AIML3-A", teacher: "AKT(Zone 4)" },
    { section: "CSE 3A", teacher: "DCE :: AGA(LAB-2)" },
    { section: "CSE 2B", teacher: "AGA" },
  ],
};
assert.deepEqual(
  new Set(classesTaughtByTeacher(db, "AKT")),
  new Set(["CSE3-A", "CSE3-B", "AIML3-A"]),
  "a teacher whose only schedule entries carry a zone/lab annotation must still see those classes"
);
assert.deepEqual(
  new Set(classesTaughtByTeacher(db, "AGA")),
  new Set(["CSE 3A", "CSE 2B"]),
  "a teacher named after the \"::\" separator must still see that class, in addition to their own unannotated ones"
);
assert.deepEqual(
  new Set(classesTaughtByTeacher(db, "DCE")),
  new Set(["CSE 3A"]),
  "the first name before \"::\" must also resolve to the shared class"
);

process.stdout.write("access-service.test.js: all assertions passed\n");
