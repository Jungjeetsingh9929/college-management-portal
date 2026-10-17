// Dependency-free tests for the pure marks/grade logic. No server or DB needed.
import assert from "node:assert/strict";
import { subjectBelongsToTeacher, subjectTeacherCodes } from "../server/services/accessService.js";
import {
  GRADE_SCALE, accessFor, academicsFor, computeOutcome, gpaOf, gradeFor, parseCredits, parseMarkValue, parseMaxMarks,
  parseSemester, rowIsComplete, semesterNumber, summarizeResults
} from "../server/services/marksService.js";

// ---- Grade scale: every boundary, on the exact side ----
const grade = (marks, max) => gradeFor(marks, max).grade;
assert.equal(GRADE_SCALE.length, 8);
assert.deepEqual(GRADE_SCALE.map((band) => band.grade), ["O", "A+", "A", "B+", "B", "C", "P", "F"]);
assert.deepEqual(GRADE_SCALE.map((band) => band.points), [10, 9, 8, 7, 6, 5, 4, 0]);
for (const [marks, expected] of [[100, "O"], [90, "O"], [89.5, "A+"], [80, "A+"], [79.5, "A"], [70, "A"], [69.5, "B+"], [60, "B+"], [59.5, "B"], [50, "B"], [49.5, "C"], [45, "C"], [44.5, "P"], [40, "P"], [39.5, "F"], [0, "F"]]) {
  assert.equal(grade(marks, 100), expected, `${marks}/100`);
}
// Boundaries hold for other maximums (exact arithmetic, no float drift).
assert.equal(grade(36, 40), "O");
assert.equal(grade(35.5, 40), "A+");
assert.equal(grade(16, 40), "P");
assert.equal(grade(15.5, 40), "F");
assert.equal(grade(90, 100), "O");
assert.equal(grade(269.5, 300), "A+");
assert.equal(grade(270, 300), "O");
assert.equal(gradeFor(95, 100, true).grade, "F", "absent is always F");
assert.equal(gradeFor(0, 0).grade, "F", "a zero maximum never divides");

// ---- Outcome ----
const sheet = { internalMax: 40, endSemMax: 60 };
assert.deepEqual(computeOutcome({ marks: 36, endSemMarks: 54, absent: false }, sheet), { totalMarks: 90, totalMax: 100, percentage: 90, grade: "O", gradePoints: 10, passed: true });
const absent = computeOutcome({ marks: 39, endSemMarks: null, absent: true }, sheet);
assert.equal(absent.grade, "F");
assert.equal(absent.gradePoints, 0);
assert.equal(absent.totalMarks, 39);
assert.equal(absent.passed, false);
assert.equal(computeOutcome({ marks: 10, endSemMarks: 20, absent: false }, { internalMax: 0, endSemMax: 60 }).totalMax, 60);

// ---- Row completeness ----
assert.equal(rowIsComplete(undefined, sheet), false);
assert.equal(rowIsComplete({ marks: 1, endSemMarks: null, absent: false }, sheet), false);
assert.equal(rowIsComplete({ marks: null, endSemMarks: 1, absent: false }, sheet), false);
assert.equal(rowIsComplete({ marks: 1, endSemMarks: 1, absent: false }, sheet), true);
assert.equal(rowIsComplete({ marks: 1, endSemMarks: null, absent: true }, sheet), true, "absent needs only internal");
assert.equal(rowIsComplete({ marks: null, endSemMarks: null, absent: true }, sheet), false);
assert.equal(rowIsComplete({ marks: null, endSemMarks: 5, absent: false }, { internalMax: 0, endSemMax: 60 }), true, "a zero-max component isn't required");

// ---- GPA ----
const r = (semester, credits, points, passed = points > 0) => ({ semester, credits, gradePoints: points, passed, code: `C${credits}${points}` });
assert.equal(gpaOf([]), null);
assert.equal(gpaOf([r(1, 0, 10)]), null, "non-credit subjects alone give no GPA");
assert.equal(gpaOf([r(1, 4, 10), r(1, 2, 7)]), 9.0, "(40+14)/6 = 9");
assert.equal(gpaOf([r(1, 3, 8), r(1, 4, 9), r(1, 0, 4)]), 8.57, "(24+36)/7 = 8.571, non-credit excluded");
assert.equal(gpaOf([r(1, 4, 0, false), r(1, 4, 10)]), 5);
const summary = summarizeResults([r(2, 4, 8), r(1, 4, 10), r(1, 2, 6), r(2, 3, 0, false)]);
assert.deepEqual(summary.semesters.map((item) => item.semester), [1, 2], "semesters sorted");
assert.equal(summary.semesters[0].sgpa, 8.67); // (40+12)/6
assert.equal(summary.semesters[1].sgpa, 4.57); // (32+0)/7
assert.equal(summary.cgpa, 6.46); // (40+12+32+0)/13 = 84/13
assert.equal(summary.totalCredits, 13);
assert.equal(summary.creditsEarned, 10, "failed subject earns no credits");
assert.equal(summarizeResults([]).cgpa, null);

// ---- Parsers ----
assert.equal(parseCredits(""), null);
assert.equal(parseCredits(undefined), null);
assert.equal(parseCredits("3"), 3);
assert.equal(parseCredits(1.5), 1.5);
assert.equal(parseCredits(0), 0);
assert.equal(parseCredits("20"), 20);
for (const bad of [-1, 20.5, 21, 0.3, "abc", "1e1x", NaN, {}, [], true]) assert.throws(() => parseCredits(bad), /Credits/, `credits ${JSON.stringify(bad)}`);
assert.equal(parseSemester(undefined), "");
assert.equal(parseSemester(""), "");
assert.equal(parseSemester(" 5 "), "5");
assert.equal(parseSemester(5), "5");
assert.equal(parseSemester("12"), "12");
for (const bad of ["0", "13", "Fall", "1.5", "-1", "05x", {}, []]) assert.throws(() => parseSemester(bad), /Semester/, `semester ${JSON.stringify(bad)}`);
assert.equal(semesterNumber({ semester: "6" }), 6);
assert.equal(semesterNumber({ semester: "Fall 2026" }), null);
assert.equal(parseMarkValue(null, 40, "Internal"), null);
assert.equal(parseMarkValue("", 40, "Internal"), null);
assert.equal(parseMarkValue("  ", 40, "Internal"), null);
assert.equal(parseMarkValue("12.5", 40, "Internal"), 12.5);
assert.equal(parseMarkValue(40, 40, "Internal"), 40);
for (const bad of [-1, 40.5, 12.3, "x", NaN, Infinity, true, {}]) assert.throws(() => parseMarkValue(bad, 40, "Internal"), /Internal/, `mark ${JSON.stringify(bad)}`);
assert.equal(parseMaxMarks("60", "End"), 60);
assert.equal(parseMaxMarks(0, "End"), 0);
for (const bad of [-1, 501, 10.5, "", "x", null, undefined]) assert.throws(() => parseMaxMarks(bad, "End"), /maximum/, `max ${JSON.stringify(bad)}`);

// ---- Teacher-to-subject matching: whole codes only ----
assert.deepEqual(subjectTeacherCodes("AYV, LRG :: SBK(ZONE-2)"), ["ayv", "lrg", "sbk"]);
assert.deepEqual(subjectTeacherCodes("DCE :: AGA(LAB-2)"), ["dce", "aga"]);
assert.deepEqual(subjectTeacherCodes("SBE (LAB-5)"), ["sbe"]);
assert.deepEqual(subjectTeacherCodes("DCE/SSR/SYN"), ["dce", "ssr", "syn"]);
assert.deepEqual(subjectTeacherCodes("A & B and C"), ["a", "b", "c"]);
assert.deepEqual(subjectTeacherCodes(""), []);
assert.deepEqual(subjectTeacherCodes(undefined), []);
assert.equal(subjectBelongsToTeacher({ teacher: "AGA" }, "A"), false, "teacher A does not own AGA's subject");
assert.equal(subjectBelongsToTeacher({ teacher: "AGA" }, "AG"), false);
assert.equal(subjectBelongsToTeacher({ teacher: "AGA" }, "aga"), true, "case-insensitive");
assert.equal(subjectBelongsToTeacher({ teacher: "AGA(LAB-2)" }, "AGA"), true);
assert.equal(subjectBelongsToTeacher({ teacher: "DCE :: AGA(LAB-2)" }, "AGA"), true);
assert.equal(subjectBelongsToTeacher({ teacher: "AGA" }, ""), false);
assert.equal(subjectBelongsToTeacher({ teacher: "AGA" }, undefined), false);
assert.equal(subjectBelongsToTeacher({ teacher: "Updated Faculty" }, "A"), false);

// ---- Access matrix (pure, on an in-memory db) ----
const subject = { id: "s1", teacher: "AGA, LRG", className: "CSE 3A", department: "" };
const dbFor = (status) => ({
  students: [{ id: "st1", className: "CSE 3A", department: "Computer Science" }],
  departments: [{ id: "d1", name: "Computer Science", hodId: "hod" }, { id: "d2", name: "Mechanical", hodId: "hod2" }],
  markSheets: status ? [{ subjectId: "s1", status }] : []
});
const users = {
  admin: { role: "admin" },
  owner: { role: "teacher", code: "AGA" },
  coOwner: { role: "teacher", code: "LRG" },
  outsider: { role: "teacher", code: "XYZ" },
  substring: { role: "teacher", code: "A" },
  hod: { role: "teacher", code: "HHH", isHod: true, hodDepartmentId: "d1" },
  otherHod: { role: "teacher", code: "HH2", isHod: true, hodDepartmentId: "d2" },
  student: { role: "student" }
};
const flags = (user, status) => { const a = accessFor(dbFor(status), user, subject); return [a.canView, a.canEdit, a.canPublish, a.canLock, a.canUnlock].map(Number).join(""); };
//                              view edit publish lock unlock
assert.equal(flags(users.admin, null), "11100");
assert.equal(flags(users.admin, "published"), "10011");
assert.equal(flags(users.admin, "locked"), "10001");
assert.equal(flags(users.owner, "draft"), "11100");
assert.equal(flags(users.coOwner, "draft"), "11100");
assert.equal(flags(users.owner, "published"), "10000");
assert.equal(flags(users.owner, "locked"), "10000");
assert.equal(flags(users.hod, "draft"), "10000", "HOD views a draft, cannot edit");
assert.equal(flags(users.hod, "published"), "10010", "HOD can lock published");
assert.equal(flags(users.hod, "locked"), "10000", "HOD cannot unlock");
assert.equal(flags(users.otherHod, "published"), "00000", "other department's HOD sees nothing");
assert.equal(flags(users.outsider, "published"), "00000");
assert.equal(flags(users.substring, "draft"), "00000", "substring of a code grants nothing");
assert.equal(flags(users.student, "published"), "00000");
assert.equal(accessFor(dbFor("draft"), users.admin, subject).role, "admin");
assert.equal(accessFor(dbFor("draft"), users.hod, subject).role, "hod");

// ---- Student dashboard summary ----
const db = { results: [
  { studentId: "s", semester: 1, credits: 4, gradePoints: 10, passed: true, grade: "O", code: "A1", subjectName: "Alpha", totalMarks: 95, totalMax: 100 },
  { studentId: "s", semester: 2, credits: 4, gradePoints: 8, passed: true, grade: "A", code: "B1", subjectName: "Beta", totalMarks: 71, totalMax: 100 },
  { studentId: "other", semester: 2, credits: 4, gradePoints: 0, passed: false, grade: "F", code: "B1", subjectName: "Beta", totalMarks: 1, totalMax: 100 }
] };
const dashboard = academicsFor(db, "s");
assert.equal(dashboard.sgpa, 8);
assert.equal(dashboard.cgpa, 9);
assert.equal(dashboard.semester, 2);
assert.deepEqual(dashboard.subjects, [{ subject: "Beta", code: "B1", marks: "71/100", grade: "A" }]);
assert.deepEqual(academicsFor({}, "s"), { sgpa: null, cgpa: null, semester: null, subjects: [] });

console.log("marks-service tests passed");
