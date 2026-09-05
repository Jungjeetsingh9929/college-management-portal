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