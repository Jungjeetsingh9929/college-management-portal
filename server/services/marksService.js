import { subjectBelongsToTeacher } from "./accessService.js";

// ---- Grade scale (10-point) ---------------------------------------------
// Thresholds are percentages of (internal + end-semester) marks. This is the
// single place to change if the university's regulations differ.
export const GRADE_SCALE = [
  { grade: "O", min: 90, points: 10, label: "Outstanding" },
  { grade: "A+", min: 80, points: 9, label: "Excellent" },
  { grade: "A", min: 70, points: 8, label: "Very good" },
  { grade: "B+", min: 60, points: 7, label: "Good" },
  { grade: "B", min: 50, points: 6, label: "Above average" },
  { grade: "C", min: 45, points: 5, label: "Average" },
  { grade: "P", min: 40, points: 4, label: "Pass" },
  { grade: "F", min: 0, points: 0, label: "Fail" }
];
export const MARK_STATUSES = ["draft", "published", "locked"];
export const MAX_SEMESTER = 12;
export const MAX_COMPONENT_MARKS = 500;
export const DEFAULT_INTERNAL_MAX = 40;
export const DEFAULT_ENDSEM_MAX = 60;

// Marks are multiples of 0.5, so every value here is exactly representable in
// binary floating point and `total * 100 >= min * max` is an exact comparison.
export function gradeFor(totalMarks, totalMax, absent = false) {
  if (absent || !(totalMax > 0)) return GRADE_SCALE[GRADE_SCALE.length - 1];
  return GRADE_SCALE.find((band) => totalMarks * 100 >= band.min * totalMax) || GRADE_SCALE[GRADE_SCALE.length - 1];
}

export function round2(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

// ---- Subject field parsing (credits / semester) ---------------------------
export function parseCredits(value) {
  if (value === undefined || value === null || value === "") return null;
  const credits = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  if (!Number.isFinite(credits) || credits < 0 || credits > 20 || !Number.isInteger(credits * 2)) {
    throw new Error("Credits must be a number from 0 to 20 in steps of 0.5.");
  }
  return credits;
}

export function parseSemester(value) {
  if (value === undefined || value === null) return "";
  const text = typeof value === "number" ? String(value) : value;
  if (typeof text !== "string") throw new Error("Semester is invalid.");
  const trimmed = text.trim();
  if (trimmed === "") return "";
  if (!/^\d{1,2}$/.test(trimmed) || Number(trimmed) < 1 || Number(trimmed) > MAX_SEMESTER) {
    throw new Error(`Semester must be a number from 1 to ${MAX_SEMESTER}.`);
  }
  return String(Number(trimmed));
}

export function semesterNumber(subject) {
  try {
    const parsed = parseSemester(subject?.semester);
    return parsed ? Number(parsed) : null;
  } catch {
    return null;
  }
}

// ---- Component marks -------------------------------------------------------
export function parseMarkValue(value, max, label) {
  if (value === undefined || value === null || value === "") return null;
  const marks = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (typeof value === "string" && value.trim() === "") return null;
  if (!Number.isFinite(marks) || marks < 0 || !Number.isInteger(marks * 2)) throw new Error(`${label} marks must be a number in steps of 0.5.`);
  if (marks > max) throw new Error(`${label} marks cannot exceed ${max}.`);
  return marks;
}

export function parseMaxMarks(value, label) {
  const max = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  if (!Number.isInteger(max) || max < 0 || max > MAX_COMPONENT_MARKS) throw new Error(`${label} maximum must be a whole number from 0 to ${MAX_COMPONENT_MARKS}.`);
  return max;
}

// Whether a row has everything the sheet requires. A component whose maximum
// is 0 is not required; an absent student needs only the internal mark.
export function rowIsComplete(row, sheet) {
  if (!row) return false;
  const internalOk = sheet.internalMax === 0 || (row.marks !== null && row.marks !== undefined);
  const endSemOk = sheet.endSemMax === 0 || row.absent === true || (row.endSemMarks !== null && row.endSemMarks !== undefined);
  return internalOk && endSemOk;
}

export function computeOutcome(row, sheet) {
  const internal = row.marks ?? 0;
  const endSem = row.absent ? 0 : row.endSemMarks ?? 0;
  const totalMarks = internal + endSem;
  const totalMax = sheet.internalMax + sheet.endSemMax;
  const band = gradeFor(totalMarks, totalMax, row.absent === true);
  return {
    totalMarks,
    totalMax,
    percentage: totalMax > 0 ? round2((totalMarks / totalMax) * 100) : 0,
    grade: band.grade,
    gradePoints: band.points,
    passed: band.grade !== "F"
  };
}

// ---- Rosters and scope -------------------------------------------------------
export function rosterFor(db, subject) {
  return (db.students || [])
    .filter((student) => student.className === subject.className && student.active !== false && (student.approvalStatus || "approved") === "approved")
    .sort((a, b) => String(a.rollNumber || "").localeCompare(String(b.rollNumber || ""), undefined, { numeric: true }));
}

export function findSheet(db, subjectId) {
  return (db.markSheets || []).find((sheet) => sheet.subjectId === subjectId) || null;
}

export function sheetStatus(db, subjectId) {
  return findSheet(db, subjectId)?.status || "draft";
}

export function hodDepartment(db, user) {
  if (user?.role !== "teacher" || !user.isHod) return null;
  return (db.departments || []).find((item) => item.id === user.hodDepartmentId) || null;
}

export function hodOverseesSubject(db, user, subject) {
  const department = hodDepartment(db, user);
  if (!department) return false;
  if (String(subject.department || "").trim() && subject.department === department.name) return true;
  return rosterFor(db, subject).some((student) => student.department === department.name);
}

// What the caller may do with a subject's mark sheet. The may* flags are
// role-based; the can* flags also require the right sheet status.
export function accessFor(db, user, subject) {
  const status = sheetStatus(db, subject.id);
  const isAdmin = user.role === "admin";
  const isSubjectTeacher = user.role === "teacher" && subjectBelongsToTeacher(subject, user.code);
  const isOverseer = !isAdmin && hodOverseesSubject(db, user, subject);
  const mayEdit = isAdmin || isSubjectTeacher;
  const mayLock = isAdmin || isOverseer;
  const mayUnlock = isAdmin;
  return {
    status,
    role: isAdmin ? "admin" : isSubjectTeacher ? "teacher" : isOverseer ? "hod" : null,
    canView: isAdmin || isSubjectTeacher || isOverseer,
    mayEdit,
    mayLock,
    mayUnlock,
    canEdit: mayEdit && status === "draft",
    canPublish: mayEdit && status === "draft",
    canLock: mayLock && status === "published",
    canUnlock: mayUnlock && status !== "draft"
  };
}

// ---- SGPA / CGPA ------------------------------------------------------------------
export function gpaOf(results) {
  const graded = results.filter((item) => Number(item.credits) > 0);
  const credits = graded.reduce((sum, item) => sum + item.credits, 0);
  if (!credits) return null;
  return round2(graded.reduce((sum, item) => sum + item.credits * item.gradePoints, 0) / credits);
}

export function summarizeResults(results) {
  const bySemester = new Map();
  for (const item of results) {
    if (!bySemester.has(item.semester)) bySemester.set(item.semester, []);
    bySemester.get(item.semester).push(item);
  }
  const semesters = [...bySemester.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([semester, items]) => ({
      semester,
      sgpa: gpaOf(items),
      credits: items.filter((item) => item.credits > 0).reduce((sum, item) => sum + item.credits, 0),
      creditsEarned: items.filter((item) => item.credits > 0 && item.passed).reduce((sum, item) => sum + item.credits, 0),
      subjects: items.sort((a, b) => String(a.code).localeCompare(String(b.code)))
    }));
  return {
    semesters,
    cgpa: gpaOf(results),
    totalCredits: semesters.reduce((sum, item) => sum + item.credits, 0),
    creditsEarned: semesters.reduce((sum, item) => sum + item.creditsEarned, 0)
  };
}

// What a student may see about one result. Internal bookkeeping (sheet ids,
// who published it) stays server-side.
export function publicResult(item, lockedSubjectIds = new Set()) {
  return {
    id: item.id,
    subjectId: item.subjectId,
    semester: item.semester,
    subjectName: item.subjectName,
    code: item.code,
    credits: item.credits,
    internalMarks: item.internalMarks,
    internalMax: item.internalMax,
    endSemMarks: item.endSemMarks,
    endSemMax: item.endSemMax,
    absent: item.absent,
    totalMarks: item.totalMarks,
    totalMax: item.totalMax,
    percentage: item.percentage,
    grade: item.grade,
    gradePoints: item.gradePoints,
    passed: item.passed,
    countsTowardGpa: item.credits > 0,
    publishedAt: item.publishedAt,
    locked: lockedSubjectIds.has(item.subjectId)
  };
}

export function resultsForStudent(db, studentId) {
  return (db.results || []).filter((item) => item.studentId === studentId && item.grade);
}

export function academicsFor(db, studentId) {
  const summary = summarizeResults(resultsForStudent(db, studentId).map((item) => ({ ...item })));
  const latest = summary.semesters[summary.semesters.length - 1];
  return {
    sgpa: latest?.sgpa ?? null,
    cgpa: summary.cgpa,
    semester: latest?.semester ?? null,
    subjects: (latest?.subjects || []).map((item) => ({ subject: item.subjectName, code: item.code, marks: `${item.totalMarks}/${item.totalMax}`, grade: item.grade }))
  };
}
