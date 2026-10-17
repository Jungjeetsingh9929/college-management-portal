const TEACHER_CODE_DELIMITERS = /,|\/|&|::|\s+and\s+/i;

// Schedule "teacher" fields carry the same free-text conventions as subject "teacher" fields (see subjectTeacherCodes below): combined codes like "AYV, LRG" or "DCE/SSR/SYN".
export function teacherCodes(value) {
  return String(value || "")
    .replace(/\([^)]*\)/g, " ")
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

// Subject records carry free-text teacher assignments such as "AGA", "AYV, LRG", "DCE/SSR/SYN".
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

// Legacy subject rows may carry a professor's display name while the authoritative timetable carries the faculty code.
export function subjectAssignedToTeacher(db, subject, teacherCode) {
  if (subjectBelongsToTeacher(subject, teacherCode)) return true;
  const subjectKeys = new Set([String(subject?.id || ""), String(subject?.code || ""), String(subject?.subjectName || "")].map((value) => value.trim().toLowerCase()).filter(Boolean));
  return (db.schedules || []).some((schedule) => scheduleBelongsToTeacher(schedule, teacherCode) && schedule.section === subject?.className && subjectKeys.has(String(schedule.subject || "").trim().toLowerCase()));
}
