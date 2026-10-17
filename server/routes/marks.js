import { Router } from "express";
import { makeId, readDb, writeDb } from "../db/fileStore.js";
import { requireAuth, requireStaff } from "../middleware/auth.js";
import { toCsv } from "../services/csv.js";
import { marksSheetPdf } from "../services/marksPdf.js";
import { appendAudit } from "../services/auditService.js";
import {
  DEFAULT_ENDSEM_MAX,
  DEFAULT_INTERNAL_MAX,
  GRADE_SCALE,
  MARK_STATUSES,
  accessFor,
  computeOutcome,
  findSheet,
  gpaOf,
  hodDepartment,
  parseMarkValue,
  parseMaxMarks,
  publicResult,
  resultsForStudent,
  rosterFor,
  rowIsComplete,
  semesterNumber,
  summarizeResults
} from "../services/marksService.js";
import { enumValue, requiredText, validId, validateKeys } from "../services/validation.js";

export const marksRouter = Router();

const MAX_ENTRIES_PER_SAVE = 500;
const MAX_REMARKS = 200;
const PASS_PERCENTAGE = GRADE_SCALE.find((band) => band.grade === "P").min;

function ensureMarksCollections(db) {
  db.markSheets ||= [];
  db.internalMarks ||= [];
  db.results ||= [];
}

function actorOf(req) {
  return { id: req.user.id, name: req.user.name, role: req.user.role };
}

function audit(db, req, action, subject, previousValue, newValue, severity = "info") {
  appendAudit(db, { userId: req.user.id, role: req.user.role, action, severity, ip: req.ip, userAgent: req.get("user-agent"), target: `subject:${subject.id}`, previousValue, newValue });
}

// Resolves a subject and the caller's access to it, or answers the request.
function resolveSubject(db, req, res) {
  if (!validId(req.params.subjectId)) { res.status(404).json({ message: "Subject not found." }); return null; }
  const subject = (db.subjects || []).find((item) => item.id === req.params.subjectId);
  if (!subject) { res.status(404).json({ message: "Subject not found." }); return null; }
  const access = accessFor(db, req.user, subject);
  if (!access.canView) { res.status(403).json({ message: "You do not have access to this mark sheet." }); return null; }
  return { subject, access };
}

function sheetDefaults(sheet) {
  return { internalMax: sheet?.internalMax ?? DEFAULT_INTERNAL_MAX, endSemMax: sheet?.endSemMax ?? DEFAULT_ENDSEM_MAX };
}

function subjectPublic(subject) {
  return {
    id: subject.id,
    subjectName: subject.subjectName,
    code: subject.code,
    className: subject.className,
    department: subject.department || "",
    semester: subject.semester || "",
    credits: Number.isFinite(subject.credits) ? subject.credits : null,
    teacher: subject.teacher
  };
}

function subjectReadiness(subject) {
  const problems = [];
  if (!semesterNumber(subject)) problems.push("The subject has no valid semester. Ask an admin to set it on the Subjects page.");
  if (!Number.isFinite(subject.credits)) problems.push("The subject has no credits set (use 0 for a non-credit subject). Ask an admin to set it on the Subjects page.");
  return problems;
}

function rowsBySubject(db, subjectId) {
  return new Map((db.internalMarks || []).filter((row) => row.subjectId === subjectId).map((row) => [row.studentId, row]));
}

function buildSheetView(db, subject, access) {
  const sheet = findSheet(db, subject.id);
  const limits = sheetDefaults(sheet);
  const status = sheet?.status || "draft";
  const roster = rosterFor(db, subject);
  const rows = rowsBySubject(db, subject.id);
  const snapshots = new Map((db.results || []).filter((item) => item.subjectId === subject.id).map((item) => [item.studentId, item]));
  const students = roster.map((student) => {
    const row = rows.get(student.id);
    const complete = rowIsComplete(row, limits);
    const snapshot = snapshots.get(student.id);
    let outcome = null;
    if (status !== "draft") outcome = snapshot ? { totalMarks: snapshot.totalMarks, totalMax: snapshot.totalMax, percentage: snapshot.percentage, grade: snapshot.grade, gradePoints: snapshot.gradePoints, passed: snapshot.passed } : null;
    else if (complete && row.marks <= limits.internalMax && (row.endSemMarks ?? 0) <= limits.endSemMax) outcome = computeOutcome(row, limits);
    return {
      studentId: student.id,
      name: student.name,
      rollNumber: student.rollNumber,
      internal: row?.marks ?? null,
      endSem: row?.endSemMarks ?? null,
      absent: row?.absent === true,
      remarks: row?.remarks || "",
      complete,
      outcome,
      missingResult: status !== "draft" && !snapshot
    };
  });
  const problems = status === "draft" ? subjectReadiness(subject) : [];
  const incomplete = students.filter((item) => !item.complete).length;
  return {
    subject: subjectPublic(subject),
    sheet: {
      exists: Boolean(sheet),
      status,
      internalMax: limits.internalMax,
      endSemMax: limits.endSemMax,
      publishedAt: sheet?.publishedAt || null,
      lockedAt: sheet?.lockedAt || null,
      history: (sheet?.history || []).slice(-20).reverse()
    },
    students,
    readiness: { problems, incomplete, ready: status === "draft" && !problems.length && !incomplete && students.length > 0 },
    access: { role: access.role, canEdit: access.canEdit, canPublish: access.canPublish, canLock: access.canLock, canUnlock: access.canUnlock },
    gradeScale: GRADE_SCALE,
    passPercentage: PASS_PERCENTAGE
  };
}

function csvResponse(res, filename, headers, rows) {
  res.set("Content-Type", "text/csv; charset=utf-8");
  res.set("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(toCsv(headers, rows));
}

function safeFilePart(value) {
  return String(value || "sheet").replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "sheet";
}

// ---- Reference ---------------------------------------------------------------

marksRouter.get("/grade-scale", requireAuth, (_req, res) => {
  res.json({ scale: GRADE_SCALE, passPercentage: PASS_PERCENTAGE, maxGradePoints: GRADE_SCALE[0].points });
});

// ---- Staff: subject list (teacher = own subjects + HOD oversight, admin = all) ----

marksRouter.get("/subjects", requireAuth, requireStaff, async (req, res) => {
  const db = await readDb();
  ensureMarksCollections(db);
  const semesterFilter = req.query.semester === undefined ? "" : String(req.query.semester);
  const classFilter = req.query.className === undefined ? "" : String(req.query.className);
  const statusFilter = req.query.status === undefined ? "" : String(req.query.status);
  const query = String(req.query.q || "").trim().toLowerCase().slice(0, 80);
  if (statusFilter && ![...MARK_STATUSES, "none"].includes(statusFilter)) return res.status(400).json({ message: "Status filter is invalid." });

  const rowsBySubjectId = new Map();
  for (const row of db.internalMarks) {
    if (!rowsBySubjectId.has(row.subjectId)) rowsBySubjectId.set(row.subjectId, new Map());
    rowsBySubjectId.get(row.subjectId).set(row.studentId, row);
  }
  const accessible = [];
  for (const subject of db.subjects || []) {
    const access = accessFor(db, req.user, subject);
    if (access.canView) accessible.push({ subject, access });
  }
  const withState = accessible.map(({ subject, access }) => {
    const sheet = findSheet(db, subject.id);
    const limits = sheetDefaults(sheet);
    const roster = rosterFor(db, subject);
    const rows = rowsBySubjectId.get(subject.id) || new Map();
    return {
      ...subjectPublic(subject),
      sheetStatus: sheet?.status || "none",
      studentCount: roster.length,
      completeCount: roster.filter((student) => rowIsComplete(rows.get(student.id), limits)).length,
      role: access.role
    };
  });
  const counts = { none: 0, draft: 0, published: 0, locked: 0 };
  withState.forEach((item) => { counts[item.sheetStatus] += 1; });
  const filtered = withState.filter((item) =>
    (!semesterFilter || item.semester === semesterFilter) &&
    (!classFilter || item.className === classFilter) &&
    (!statusFilter || item.sheetStatus === statusFilter) &&
    (!query || `${item.subjectName} ${item.code} ${item.className} ${item.teacher}`.toLowerCase().includes(query))
  ).sort((a, b) => a.className.localeCompare(b.className) || a.code.localeCompare(b.code));
  res.json({
    subjects: filtered.slice(0, 500),
    total: filtered.length,
    counts,
    classes: [...new Set(withState.map((item) => item.className))].sort()
  });
});

// ---- Staff: one mark sheet ------------------------------------------------------

marksRouter.get("/sheet/:subjectId", requireAuth, requireStaff, async (req, res) => {
  const db = await readDb();
  ensureMarksCollections(db);
  const resolved = resolveSubject(db, req, res);
  if (!resolved) return;
  res.json(buildSheetView(db, resolved.subject, resolved.access));
});

// Saves the sheet's maximums and/or any number of student rows in one atomic
// request. Omitted entry fields are left unchanged; null clears a value.
marksRouter.put("/sheet/:subjectId", requireAuth, requireStaff, async (req, res) => {
  const db = await readDb();
  ensureMarksCollections(db);
  const resolved = resolveSubject(db, req, res);
  if (!resolved) return;
  const { subject, access } = resolved;
  if (!access.mayEdit) return res.status(403).json({ message: "Only the subject teacher or an admin can enter marks." });
  if (access.status !== "draft") return res.status(409).json({ message: `This sheet is ${access.status}. Ask an admin to unlock it before editing marks.` });

  const body = req.body || {};
  try { validateKeys(body, ["internalMax", "endSemMax", "entries"]); } catch { return res.status(400).json({ message: "Request contains unsupported fields." }); }
  const existingSheet = findSheet(db, subject.id);
  const current = sheetDefaults(existingSheet);
  let internalMax; let endSemMax;
  try {
    internalMax = body.internalMax === undefined ? current.internalMax : parseMaxMarks(body.internalMax, "Internal");
    endSemMax = body.endSemMax === undefined ? current.endSemMax : parseMaxMarks(body.endSemMax, "End-semester");
  } catch (error) { return res.status(400).json({ message: error.message }); }
  if (internalMax + endSemMax < 1) return res.status(400).json({ message: "Internal and end-semester maximums cannot both be zero." });

  const entries = body.entries === undefined ? [] : body.entries;
  if (!Array.isArray(entries) || entries.length > MAX_ENTRIES_PER_SAVE) return res.status(400).json({ message: `Send at most ${MAX_ENTRIES_PER_SAVE} entries.` });
  const roster = rosterFor(db, subject);
  const rosterIds = new Set(roster.map((student) => student.id));
  const existingRows = rowsBySubject(db, subject.id);
  // Work on copies; nothing is written until every value has validated.
  const next = new Map(roster.map((student) => {
    const row = existingRows.get(student.id);
    return [student.id, { marks: row?.marks ?? null, endSemMarks: row?.endSemMarks ?? null, absent: row?.absent === true, remarks: row?.remarks || "" }];
  }));
  const touched = new Set();
  try {
    for (const entry of entries) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("Each entry must be an object.");
      validateKeys(entry, ["studentId", "internal", "endSem", "absent", "remarks"]);
      if (typeof entry.studentId !== "string" || !rosterIds.has(entry.studentId)) throw new Error("An entry refers to a student who is not in this class.");
      if (touched.has(entry.studentId)) throw new Error("A student appears more than once.");
      touched.add(entry.studentId);
      const target = next.get(entry.studentId);
      if ("internal" in entry) target.marks = parseMarkValue(entry.internal, internalMax, "Internal");
      if ("endSem" in entry) target.endSemMarks = parseMarkValue(entry.endSem, endSemMax, "End-semester");
      if ("absent" in entry) {
        if (typeof entry.absent !== "boolean") throw new Error("Absent must be true or false.");
        target.absent = entry.absent;
      }
      if ("remarks" in entry) {
        if (entry.remarks !== null && typeof entry.remarks !== "string") throw new Error("Remarks must be text.");
        target.remarks = String(entry.remarks || "").trim();
        if (target.remarks.length > MAX_REMARKS) throw new Error(`Remarks can be at most ${MAX_REMARKS} characters.`);
      }
      if (target.absent && target.endSemMarks !== null) throw new Error("An absent student cannot have end-semester marks.");
    }
    // Existing values must still fit the (possibly changed) maximums.
    for (const values of next.values()) {
      if (values.marks !== null && values.marks > internalMax) throw new Error(`A student's internal marks exceed the maximum of ${internalMax}.`);
      if (values.endSemMarks !== null && values.endSemMarks > endSemMax) throw new Error(`A student's end-semester marks exceed the maximum of ${endSemMax}.`);
      if (values.absent && values.endSemMarks !== null) throw new Error("An absent student cannot have end-semester marks.");
    }
  } catch (error) { return res.status(400).json({ message: error.message }); }

  const now = new Date().toISOString();
  let sheet = existingSheet;
  if (!sheet) {
    sheet = { id: makeId("msheet"), subjectId: subject.id, internalMax, endSemMax, status: "draft", createdAt: now, history: [] };
    db.markSheets.push(sheet);
  }
  Object.assign(sheet, { internalMax, endSemMax, updatedAt: now });
  for (const [studentId, values] of next) {
    let row = existingRows.get(studentId);
    const isTouched = touched.has(studentId);
    if (!row && !isTouched) continue;
    if (!row) {
      row = { id: makeId("mrk"), studentId, subjectId: subject.id };
      db.internalMarks.push(row);
    }
    // `marks`/`maxMarks` keep their original meaning (internal marks) so
    // older readers of db.internalMarks keep working.
    Object.assign(row, { marks: values.marks, maxMarks: internalMax, endSemMarks: values.endSemMarks, absent: values.absent, remarks: values.remarks });
    if (isTouched) Object.assign(row, { teacherId: req.user.id, updatedBy: actorOf(req), updatedAt: now });
  }
  // Keep the legacy per-row maximum aligned for rows a maximum change didn't otherwise touch.
  for (const row of existingRows.values()) row.maxMarks = internalMax;
  await writeDb(db);
  res.json(buildSheetView(db, subject, accessFor(db, req.user, subject)));
});

marksRouter.post("/sheet/:subjectId/publish", requireAuth, requireStaff, async (req, res) => {
  const db = await readDb();
  ensureMarksCollections(db);
  const resolved = resolveSubject(db, req, res);
  if (!resolved) return;
  const { subject, access } = resolved;
  if (!access.mayEdit) return res.status(403).json({ message: "Only the subject teacher or an admin can publish marks." });
  try { validateKeys(req.body || {}, []); } catch { return res.status(400).json({ message: "Request contains unsupported fields." }); }
  if (access.status !== "draft") return res.status(409).json({ message: `This sheet is already ${access.status}.` });

  const sheet = findSheet(db, subject.id);
  if (!sheet) return res.status(409).json({ message: "Enter and save marks before publishing." });
  const problems = subjectReadiness(subject);
  if (problems.length) return res.status(409).json({ message: problems[0], problems });
  const roster = rosterFor(db, subject);
  if (!roster.length) return res.status(409).json({ message: "This class has no enrolled students, so there is nothing to publish." });
  const rows = rowsBySubject(db, subject.id);
  const missing = roster.filter((student) => {
    const row = rows.get(student.id);
    return !rowIsComplete(row, sheet) || (row.marks ?? 0) > sheet.internalMax || (row.endSemMarks ?? 0) > sheet.endSemMax;
  });
  if (missing.length) {
    return res.status(409).json({
      message: `${missing.length} student${missing.length > 1 ? "s have" : " has"} missing or invalid marks. Complete every row (or mark the student absent) before publishing.`,
      missing: missing.slice(0, 50).map((student) => ({ studentId: student.id, name: student.name, rollNumber: student.rollNumber })),
      missingCount: missing.length
    });
  }

  const now = new Date().toISOString();
  const semester = semesterNumber(subject);
  db.results = db.results.filter((item) => item.subjectId !== subject.id);
  for (const student of roster) {
    const row = rows.get(student.id);
    const outcome = computeOutcome(row, sheet);
    db.results.push({
      id: makeId("res"),
      studentId: student.id,
      subjectId: subject.id,
      sheetId: sheet.id,
      className: subject.className,
      department: student.department || "",
      semester,
      // Snapshot of the subject as it was at publication, so later subject
      // edits cannot change a transcript. `subject` is the legacy field the
      // "Result published" notification reads.
      subject: subject.subjectName,
      subjectName: subject.subjectName,
      code: subject.code,
      credits: subject.credits,
      internalMarks: row.marks ?? null,
      internalMax: sheet.internalMax,
      endSemMarks: row.absent ? null : row.endSemMarks ?? null,
      endSemMax: sheet.endSemMax,
      absent: row.absent === true,
      ...outcome,
      publishedAt: now,
      publishedBy: actorOf(req)
    });
  }
  Object.assign(sheet, { status: "published", publishedAt: now, publishedBy: actorOf(req), lockedAt: null, lockedBy: null, updatedAt: now });
  sheet.history.push({ action: "publish", at: now, by: actorOf(req), students: roster.length });
  audit(db, req, "marks.publish", subject, { status: "draft" }, { status: "published", students: roster.length });
  await writeDb(db);
  res.json({ ...buildSheetView(db, subject, accessFor(db, req.user, subject)), published: roster.length });
});

marksRouter.post("/sheet/:subjectId/lock", requireAuth, requireStaff, async (req, res) => {
  const db = await readDb();
  ensureMarksCollections(db);
  const resolved = resolveSubject(db, req, res);
  if (!resolved) return;
  const { subject, access } = resolved;
  if (!access.mayLock) return res.status(403).json({ message: "Only an admin or the Head of Department can lock results." });
  try { validateKeys(req.body || {}, []); } catch { return res.status(400).json({ message: "Request contains unsupported fields." }); }
  if (access.status !== "published") return res.status(409).json({ message: access.status === "locked" ? "This sheet is already locked." : "Only a published sheet can be locked." });
  const sheet = findSheet(db, subject.id);
  const now = new Date().toISOString();
  Object.assign(sheet, { status: "locked", lockedAt: now, lockedBy: actorOf(req), updatedAt: now });
  sheet.history.push({ action: "lock", at: now, by: actorOf(req) });
  audit(db, req, "marks.lock", subject, { status: "published" }, { status: "locked" });
  await writeDb(db);
  res.json(buildSheetView(db, subject, accessFor(db, req.user, subject)));
});

// The only way back. Results are withdrawn from students while the sheet is
// corrected, and the reason is kept on the sheet and in the audit log.
marksRouter.post("/sheet/:subjectId/unlock", requireAuth, requireStaff, async (req, res) => {
  const db = await readDb();
  ensureMarksCollections(db);
  const resolved = resolveSubject(db, req, res);
  if (!resolved) return;
  const { subject, access } = resolved;
  if (!access.mayUnlock) return res.status(403).json({ message: "Only an admin can unlock published results." });
  let reason;
  try {
    validateKeys(req.body || {}, ["reason"]);
    reason = requiredText(req.body.reason, "Reason", { min: 5, max: 300 });
  } catch { return res.status(400).json({ message: "A reason of 5 to 300 characters is required to unlock results." }); }
  if (access.status === "draft") return res.status(409).json({ message: "This sheet is already open for editing." });
  const sheet = findSheet(db, subject.id);
  const now = new Date().toISOString();
  const previousStatus = sheet.status;
  const before = db.results.length;
  db.results = db.results.filter((item) => item.subjectId !== subject.id);
  const withdrawn = before - db.results.length;
  Object.assign(sheet, { status: "draft", publishedAt: null, publishedBy: null, lockedAt: null, lockedBy: null, updatedAt: now });
  sheet.history.push({ action: "unlock", at: now, by: actorOf(req), reason, fromStatus: previousStatus, resultsWithdrawn: withdrawn });
  audit(db, req, "marks.unlock", subject, { status: previousStatus }, { status: "draft", reason, resultsWithdrawn: withdrawn }, "warning");
  await writeDb(db);
  res.json({ ...buildSheetView(db, subject, accessFor(db, req.user, subject)), withdrawn });
});

marksRouter.get("/sheet/:subjectId/export.csv", requireAuth, requireStaff, async (req, res) => {
  const db = await readDb();
  ensureMarksCollections(db);
  const resolved = resolveSubject(db, req, res);
  if (!resolved) return;
  const view = buildSheetView(db, resolved.subject, resolved.access);
  const rows = view.students.map((item) => [
    item.rollNumber, item.name, view.subject.className, item.internal ?? "", item.endSem ?? "", item.absent ? "AB" : "",
    item.outcome?.totalMarks ?? "", item.outcome ? item.outcome.percentage : "", item.outcome?.grade ?? "", item.outcome?.gradePoints ?? "", view.sheet.status
  ]);
  csvResponse(res, `marks-${safeFilePart(view.subject.code)}-${safeFilePart(view.subject.className)}.csv`,
    ["Roll number", "Student", "Class", `Internal (/${view.sheet.internalMax})`, `End-sem (/${view.sheet.endSemMax})`, "Absent", "Total", "Percentage", "Grade", "Grade points", "Sheet status"], rows);
});

marksRouter.get("/sheet/:subjectId/export.pdf", requireAuth, requireStaff, async (req, res) => {
  const db = await readDb();
  ensureMarksCollections(db);
  const resolved = resolveSubject(db, req, res);
  if (!resolved) return;
  const view = buildSheetView(db, resolved.subject, resolved.access);
  res.set("Content-Type", "application/pdf");
  res.set("Cache-Control", "no-store");
  res.attachment(`marks-${safeFilePart(view.subject.code)}-${safeFilePart(view.subject.className)}.pdf`);
  marksSheetPdf(view, res);
});

// ---- Students ------------------------------------------------------------------------

function studentResultsPayload(db, student) {
  const lockedSubjects = new Set((db.markSheets || []).filter((sheet) => sheet.status === "locked").map((sheet) => sheet.subjectId));
  const summary = summarizeResults(resultsForStudent(db, student.id).map((item) => publicResult(item, lockedSubjects)));
  return {
    student: { id: student.id, name: student.name, rollNumber: student.rollNumber, className: student.className, department: student.department },
    ...summary,
    gradeScale: GRADE_SCALE,
    passPercentage: PASS_PERCENTAGE
  };
}

marksRouter.get("/me", requireAuth, async (req, res) => {
  if (req.user.role !== "student") return res.status(403).json({ message: "Student access is required." });
  const db = await readDb();
  const student = (db.students || []).find((item) => item.id === req.user.id);
  if (!student) return res.status(404).json({ message: "Student not found." });
  res.json(studentResultsPayload(db, student));
});

// Admin: any student. HOD: students of their own department. Subject teachers
// do not get a cross-subject transcript.
marksRouter.get("/students/:studentId", requireAuth, requireStaff, async (req, res) => {
  const db = await readDb();
  if (!validId(req.params.studentId)) return res.status(404).json({ message: "Student not found." });
  const student = (db.students || []).find((item) => item.id === req.params.studentId);
  if (!student) return res.status(404).json({ message: "Student not found." });
  if (req.user.role !== "admin") {
    const department = hodDepartment(db, req.user);
    if (!department) return res.status(403).json({ message: "Admin or Head of Department access is required." });
    if (student.department !== department.name) return res.status(403).json({ message: "This student is outside your department." });
  }
  res.json(studentResultsPayload(db, student));
});

// ---- Admin / HOD: results export ---------------------------------------------------------

marksRouter.get("/export.csv", requireAuth, requireStaff, async (req, res) => {
  const db = await readDb();
  ensureMarksCollections(db);
  let departmentName = null;
  if (req.user.role !== "admin") {
    const department = hodDepartment(db, req.user);
    if (!department) return res.status(403).json({ message: "Admin or Head of Department access is required." });
    departmentName = department.name;
  }
  const view = req.query.view === undefined ? "results" : String(req.query.view);
  try { enumValue(view, "View", ["results", "summary"]); } catch { return res.status(400).json({ message: "View must be results or summary." }); }
  const className = req.query.className === undefined ? "" : String(req.query.className).slice(0, 80);
  const subjectId = req.query.subjectId === undefined ? "" : String(req.query.subjectId);
  const semesterText = req.query.semester === undefined ? "" : String(req.query.semester);
  if (subjectId && !validId(subjectId)) return res.status(400).json({ message: "Subject is invalid." });
  if (semesterText && !/^\d{1,2}$/.test(semesterText)) return res.status(400).json({ message: "Semester is invalid." });
  if (view === "summary" && !semesterText) return res.status(400).json({ message: "Choose a semester for the SGPA summary." });
  const semester = semesterText ? Number(semesterText) : null;

  const students = new Map((db.students || []).map((student) => [student.id, student]));
  const lockedSubjects = new Set(db.markSheets.filter((sheet) => sheet.status === "locked").map((sheet) => sheet.subjectId));
  const inScope = (item) => {
    const student = students.get(item.studentId);
    return student && (!departmentName || student.department === departmentName) && (!className || item.className === className);
  };
  const results = db.results.filter((item) => item.grade && inScope(item));
  const byRoll = (a, b) => String(students.get(a.studentId)?.rollNumber || "").localeCompare(String(students.get(b.studentId)?.rollNumber || ""), undefined, { numeric: true });

  if (view === "results") {
    const rows = results
      .filter((item) => (!semester || item.semester === semester) && (!subjectId || item.subjectId === subjectId))
      .sort((a, b) => a.className.localeCompare(b.className) || byRoll(a, b) || a.semester - b.semester || String(a.code).localeCompare(String(b.code)))
      .map((item) => {
        const student = students.get(item.studentId);
        return [student.rollNumber, student.name, item.className, student.department, item.semester, item.code, item.subjectName, item.credits, item.internalMarks ?? "", item.absent ? "AB" : item.endSemMarks ?? "", item.totalMarks, item.totalMax, item.percentage, item.grade, item.gradePoints, item.passed ? "Pass" : "Fail", lockedSubjects.has(item.subjectId) ? "locked" : "published"];
      });
    return csvResponse(res, "results.csv", ["Roll number", "Student", "Class", "Department", "Semester", "Subject code", "Subject", "Credits", "Internal", "End-sem", "Total", "Out of", "Percentage", "Grade", "Grade points", "Result", "Status"], rows);
  }

  const perStudent = new Map();
  for (const item of results) {
    if (!perStudent.has(item.studentId)) perStudent.set(item.studentId, []);
    perStudent.get(item.studentId).push(item);
  }
  const rows = [...perStudent.entries()]
    .filter(([, items]) => items.some((item) => item.semester === semester))
    .map(([studentId, items]) => {
      const student = students.get(studentId);
      const semesterItems = items.filter((item) => item.semester === semester);
      const summary = summarizeResults(items.map((item) => ({ ...item })));
      return { student, semesterItems, sgpa: gpaOf(semesterItems), cgpa: summary.cgpa, earned: summary.creditsEarned, backlogs: semesterItems.filter((item) => !item.passed).length };
    })
    .sort((a, b) => String(a.student.className).localeCompare(String(b.student.className)) || String(a.student.rollNumber).localeCompare(String(b.student.rollNumber), undefined, { numeric: true }))
    .map((item) => [item.student.rollNumber, item.student.name, item.student.className, item.student.department, semester, item.semesterItems.length, item.backlogs, item.sgpa ?? "", item.cgpa ?? "", item.earned]);
  csvResponse(res, `sgpa-semester-${semester}.csv`, ["Roll number", "Student", "Class", "Department", "Semester", "Subjects", "Failed subjects", "SGPA", "CGPA (all semesters)", "Credits earned (all semesters)"], rows);
});
