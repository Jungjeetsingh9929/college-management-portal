const TEACHER_CODE_DELIMITERS = /,|\/|&|\s+and\s+/i;

export function teacherCodes(value) {
  return String(value || "")
    .split(TEACHER_CODE_DELIMITERS)
    .map((code) => code.trim().toLowerCase())
    .filter(Boolean);
}

export function scheduleBelongsToTeacher(schedule, teacherCode) {
  return teacherCodes(schedule?.teacher).includes(String(teacherCode || "").trim().toLowerCase());
}

export function classesTaughtByTeacher(db, teacherCode) {
  return [
    ...new Set(
      (db.schedules || [])
        .filter((schedule) => scheduleBelongsToTeacher(schedule, teacherCode))
        .map((schedule) => schedule.section)
        .filter(Boolean)
    )
  ];
}

export function studentIdsVisibleToTeacher(db, teacherCode) {
  const classes = new Set(classesTaughtByTeacher(db, teacherCode));
  return new Set((db.students || []).filter((student) => classes.has(student.className)).map((student) => student.id));
}

// The department an HOD user administers. Was previously duplicated
// identically in routes/fees.js and routes/hod.js.
export function departmentFor(db, req) {
  return (db.departments || []).find((item) => item.id === req.user.hodDepartmentId);
}

// Subject records carry free-text teacher assignments such as "AGA",
// "AYV, LRG", "DCE/SSR/SYN", "AGA(LAB-2)" or "DCE :: AGA(LAB-2)". teacherCodes()
// above does not understand the "::" separator or the "(LAB-2)" annotations,
// so this parser is used for subject ownership (marks entry). Matching is on
// whole codes only: teacher "A" does not own a subject taught by "AGA".
export function subjectTeacherCodes(value) {
  return String(value || "")
    .replace(/\([^)]*\)/g, " ")
    .split(/,|\/|&|::|\s+and\s+/i)
    .map((code) => code.trim().toLowerCase())
    .filter(Boolean);
}

export function subjectBelongsToTeacher(subject, teacherCode) {
  const code = String(teacherCode || "").trim().toLowerCase();
  return Boolean(code) && subjectTeacherCodes(subject?.teacher).includes(code);
}
