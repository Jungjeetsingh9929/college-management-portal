process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-attendance-secret-32-chars-long";
process.env.SEED_ADMIN_EMAIL = "admin@example.edu";
process.env.SEED_ADMIN_PASSWORD = "Test-admin-password1!";
process.env.SEED_STUDENT_PASSWORD = "Test-student-password1!";
process.env.E2E_FACULTY_PASSWORD = "Test-e2e-faculty1!";
process.env.E2E_ADMIN_PASSWORD = "Test-e2e-admin1!";
process.env.DEMO_LOGIN_PASSWORD = "Test-demo-login1!";
process.env.FACULTY_LRG_PASSWORD = "Test-lrg-faculty1!";
process.env.COLLEGE_LATITUDE = "27.2124649";
process.env.COLLEGE_LONGITUDE = "75.7002425";
process.env.COLLEGE_RADIUS_METERS = "300";
// The suite issues well over 120 requests from one IP inside a minute; keep the
// global per-IP limiter (default 120/min) from turning that into spurious 429s.
process.env.PUBLIC_API_LIMIT = "2000";
// Payments must stay usable-but-inert without a provider: make sure a developer's
// shell can't leak real credentials into this suite (tests/payments-api.test.js covers
// the configured path).
for (const name of ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET", "RAZORPAY_ALLOW_LIVE", "RAZORPAY_API_BASE"]) delete process.env[name];

import assert from "node:assert/strict";

const { resetDb } = await import("../server/db/fileStore.js");
const { default: app } = await import("../server/index.js");
await resetDb();

const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}/api`;

async function request(path, options = {}) {
  // Mirrors the real client's apiFetch: don't force a JSON content-type on
  // FormData bodies, or fetch's multipart boundary header gets clobbered.
  const baseHeaders = options.body instanceof FormData ? {} : { "Content-Type": "application/json" };
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { ...baseHeaders, ...(options.headers || {}) }
  });
  const raw = await response.text();
  const data = raw ? JSON.parse(raw) : {};
  return { response, data };
}

async function json(path, options = {}) {
  const { response, data } = await request(path, options);
  if (!response.ok) throw new Error(data.message || `HTTP ${response.status}`);
  return data;
}

try {
  const health = await request("/health");
  assert.equal(health.response.status, 200);
  assert.equal(health.response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(health.response.headers.get("x-frame-options"), "DENY");
  assert.equal(health.response.headers.get("cache-control"), "no-store");
  const missingRoute = await request("/does-not-exist");
  assert.equal(missingRoute.response.status, 404);
  assert.deepEqual(missingRoute.data, { message: "API route not found." });

  const admin = await json("/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email: process.env.SEED_ADMIN_EMAIL,
      password: process.env.SEED_ADMIN_PASSWORD,
      role: "admin"
    })
  });
  assert.equal(admin.user.role, "admin");

  const adminFees = await json("/admin/fees", {
    headers: { Authorization: `Bearer ${admin.token}` }
  });
  assert.ok(adminFees.structures.length > 0);
  assert.ok(adminFees.studentFees.length > 0);
  assert.ok(adminFees.studentFees.every((item) => !("password" in item)));
  const firstDepartment = adminFees.structures[0].departmentId;
  const feeDepartmentStudents = await json(`/students?department=${encodeURIComponent(adminFees.structures[0].departmentName)}`, {
    headers: { Authorization: `Bearer ${admin.token}` }
  });
  const feeTestStudentRecord = feeDepartmentStudents.students.find((item) => /^student\d+@example\.edu$/.test(item.email));
  assert.ok(feeTestStudentRecord, "seed data should contain a roster student in the first fee department");
  const updatedStructure = await json(`/admin/fees/structures/${firstDepartment}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${admin.token}` },
    body: JSON.stringify({ tuitionFee: 54321, hostelFee: 0, examFee: 0, otherFee: 0, dueDate: "2027-01-07" })
  });
  assert.equal(updatedStructure.structure.tuitionFee, 54321);
  const feeTestStudentLogin = await json("/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email: feeTestStudentRecord.email,
      password: process.env.SEED_STUDENT_PASSWORD,
      role: "student"
    })
  });
  const feeTestStudentPortal = await json("/shared/student/portal", {
    headers: { Authorization: `Bearer ${feeTestStudentLogin.token}` }
  });
  assert.equal(feeTestStudentPortal.fees.amountDue, 54321, "student portal fees.amountDue should reflect the admin-set fee structure");
  assert.equal(feeTestStudentPortal.fees.status, "due");

  const departmentNotice = await json("/admin/notices", {
    method: "POST",
    headers: { Authorization: `Bearer ${admin.token}` },
    body: JSON.stringify({ departmentId: firstDepartment, title: "Fee desk hours", body: "The finance desk is open this week.", category: "fee" })
  });
  assert.equal(departmentNotice.notice.departmentId, firstDepartment);

  const student = await json("/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email: "student001@example.edu",
      password: process.env.SEED_STUDENT_PASSWORD,
      role: "student"
    })
  });
  assert.equal(student.user.role, "student");

  const studentFeesDenied = await request("/admin/fees", {
    headers: { Authorization: `Bearer ${student.token}` }
  });
  assert.equal(studentFeesDenied.response.status, 403);

  const teacher = await json("/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email: "lrg@example.edu",
      password: process.env.FACULTY_LRG_PASSWORD,
      role: "teacher"
    })
  });
  assert.equal(teacher.user.role, "teacher");

  for (const expectedRole of ["admin", "teacher", "student"]) {
    const demoLogin = await json("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "example@gmail.com", password: process.env.DEMO_LOGIN_PASSWORD, role: expectedRole })
    });
    assert.equal(demoLogin.user.role, expectedRole);
  }

  const teacherStudents = await json("/faculty/students", {
    headers: { Authorization: `Bearer ${teacher.token}` }
  });
  assert.ok(teacherStudents.students.length > 0);

  const allStudents = await json("/students", {
    headers: { Authorization: `Bearer ${admin.token}` }
  });
  const visibleIds = new Set(teacherStudents.students.map((item) => item.id));
  const outsideStudent = allStudents.students.find((item) => !visibleIds.has(item.id));
  assert.ok(outsideStudent, "seed data should contain a student outside the teacher's classes");

  const deniedSummary = await request(`/attendance/summary?studentId=${outsideStudent.id}`, {
    headers: { Authorization: `Bearer ${teacher.token}` }
  });
  assert.equal(deniedSummary.response.status, 403);

  const newTeacher = await json("/teachers", {
    method: "POST",
    headers: { Authorization: `Bearer ${admin.token}` },
    body: JSON.stringify({
      code: "JRT",
      name: "Jungjeet Rathore",
      department: "Computer Science",
      email: "teacher-demo@example.edu",
      password: "Teacher-demo-password1!",
      subjects: []
    })
  });
  const newTeacherLogin = await json("/auth/login", {
      method: "POST",
      body: JSON.stringify({
      email: "teacher-demo@example.edu",
      password: "Teacher-demo-password1!",
      role: "teacher"
    })
  });
  assert.equal(newTeacherLogin.user.id, newTeacher.teacher.id);

  const quizClass = teacherStudents.students.find((item) => item.id === student.user.id)?.className;
  assert.ok(quizClass, "student001 should be in at least one seeded teacher class");
  const subjects = await json("/subjects", {
    headers: { Authorization: `Bearer ${admin.token}` }
  });
  const quizSubject = subjects.subjects.find((item) => item.className === quizClass);
  assert.ok(quizSubject);

  // Fix 3 regression test: fire two concurrent mutating requests (different
  // students, same teacher/subject) against the live server. Each request
  // triggers its own independent recordAudit() readDb()->writeDb() cycle
  // (server/index.js's audit-logging middleware, writing to db.auditLogs -
  // NOT the same thing as db.attendanceAudit, which upsertAttendance writes
  // synchronously within the route's own writeDb call). Before the fix,
  // recordAudit's write for one request could run outside databaseWriteLock
  // and clobber the other's attendance write with a stale full-document
  // overwrite. Confirm both the attendance records and both security
  // audit-log entries survive.
  const sameClassStudents = teacherStudents.students.filter((item) => item.className === quizClass);
  assert.ok(sameClassStudents.length >= 2, "need at least two students in the teacher's class for the concurrency test");
  const [concurrencyStudentA, concurrencyStudentB] = sameClassStudents;
  const concurrencyDate = "2026-01-15";
  const securityLogsBefore = await json("/admin/security?eventType=attendance%2Fmark", {
    headers: { Authorization: `Bearer ${admin.token}` }
  });
  const successfulMarkLogsBefore = securityLogsBefore.auditLogs.filter((item) => item.success !== false).length;

  const [concurrentMarkA, concurrentMarkB] = await Promise.all([
    json("/attendance/mark", {
      method: "POST",
      headers: { Authorization: `Bearer ${teacher.token}` },
      body: JSON.stringify({ studentId: concurrencyStudentA.id, subjectId: quizSubject.id, status: "present", date: concurrencyDate })
    }),
    json("/attendance/mark", {
      method: "POST",
      headers: { Authorization: `Bearer ${teacher.token}` },
      body: JSON.stringify({ studentId: concurrencyStudentB.id, subjectId: quizSubject.id, status: "late", date: concurrencyDate })
    })
  ]);
  assert.equal(concurrentMarkA.record.studentId, concurrencyStudentA.id);
  assert.equal(concurrentMarkB.record.studentId, concurrencyStudentB.id);

  const attendanceAuditA = await json(`/attendance/audit?studentId=${concurrencyStudentA.id}`, {
    headers: { Authorization: `Bearer ${teacher.token}` }
  });
  const attendanceAuditB = await json(`/attendance/audit?studentId=${concurrencyStudentB.id}`, {
    headers: { Authorization: `Bearer ${teacher.token}` }
  });
  assert.ok(
    attendanceAuditA.audit.some((item) => item.next?.date === concurrencyDate && item.next?.status === "present"),
    "student A's concurrent attendance write must survive in a fresh read of the database, not be reverted by a colliding overwrite"
  );
  assert.ok(
    attendanceAuditB.audit.some((item) => item.next?.date === concurrencyDate && item.next?.status === "late"),
    "student B's concurrent attendance write must survive in a fresh read of the database, not be reverted by a colliding overwrite"
  );

  const securityLogsAfter = await json("/admin/security?eventType=attendance%2Fmark", {
    headers: { Authorization: `Bearer ${admin.token}` }
  });
  const successfulMarkLogsAfter = securityLogsAfter.auditLogs.filter((item) => item.success !== false).length;
  assert.equal(
    successfulMarkLogsAfter,
    successfulMarkLogsBefore + 2,
    "both concurrent attendance-mark requests should each produce their own db.auditLogs entry - neither should be silently dropped by the write-lock race"
  );

  const quiz = await json("/faculty/quizzes", {
    method: "POST",
    headers: { Authorization: `Bearer ${teacher.token}` },
    body: JSON.stringify({
      question: "Which option is correct?",
      options: ["Wrong", "Correct"],
      correctAnswerIndex: 1,
      className: quizClass,
      subjectId: quizSubject.id
    })
  });

  const wrongAnswer = await json(`/shared/quiz/${quiz.quiz.id}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${student.token}` }
  });
  assert.equal(wrongAnswer.quiz.attempted, false);

  const firstAttempt = await request(`/shared/student/quiz/${quiz.quiz.id}/answer`, {
    method: "POST",
    headers: { Authorization: `Bearer ${student.token}` },
    body: JSON.stringify({ answerIndex: 0, latitude: 27.2124649, longitude: 75.7002425, accuracy: 10 })
  });
  assert.equal(firstAttempt.response.status, 200);
  assert.equal(firstAttempt.data.correct, false);

  const secondAttempt = await request(`/shared/student/quiz/${quiz.quiz.id}/answer`, {
    method: "POST",
    headers: { Authorization: `Bearer ${student.token}` },
    body: JSON.stringify({ answerIndex: 1, latitude: 27.2124649, longitude: 75.7002425, accuracy: 10 })
  });
  assert.equal(secondAttempt.response.status, 409);

  // QR attendance check-in: real /attend/:sessionId URL, bell notification,
  // check-in, nonce replay protection, and QR rotation invalidating the old
  // token. See server/routes/attendance.js and client/src/pages/AttendCheckIn.jsx.
  const attendanceSession = await json("/attendance/sessions", {
    method: "POST",
    headers: { Authorization: `Bearer ${teacher.token}` },
    body: JSON.stringify({ subjectId: quizSubject.id, durationMinutes: 30, lateAfterMinutes: 10 })
  });
  const qrUrlPattern = new RegExp(`^https?://[^/]+/attend/${attendanceSession.session.id}\\?t=${attendanceSession.session.qrToken}$`);
  assert.ok(qrUrlPattern.test(attendanceSession.session.qr), `session.qr should be a real /attend/:sessionId URL, got ${attendanceSession.session.qr}`);
  // qrPath is what the client encodes into the QR image, resolved against
  // window.location.origin so a misconfigured CLIENT_ORIGIN can't bake an
  // unreachable host into a scannable code.
  const qrPathPattern = new RegExp(`^/attend/${attendanceSession.session.id}\\?t=${attendanceSession.session.qrToken}$`);
  assert.ok(qrPathPattern.test(attendanceSession.session.qrPath), `session.qrPath should be origin-less, got ${attendanceSession.session.qrPath}`);
  assert.ok(attendanceSession.session.qr.endsWith(attendanceSession.session.qrPath), "session.qr should be qrPath resolved against the configured origin");
  assert.ok(attendanceSession.session.qrOriginSource, "session.qrOriginSource should explain where the absolute origin came from");

  const teacherSessions = await json("/attendance/sessions", { headers: { Authorization: `Bearer ${teacher.token}` } });
  const listedSession = teacherSessions.sessions.find((item) => item.id === attendanceSession.session.id);
  assert.ok(qrUrlPattern.test(listedSession.qr), "GET /attendance/sessions should return the same real check-in URL");
  assert.ok(qrPathPattern.test(listedSession.qrPath), "GET /attendance/sessions should return the same origin-less qrPath");

  const studentNotifications = await json("/shared/notifications", { headers: { Authorization: `Bearer ${student.token}` } });
  const sessionNotification = studentNotifications.notifications.find((item) => item.id === `attendance-session:${attendanceSession.session.id}:${attendanceSession.session.sequence}`);
  assert.ok(sessionNotification, "a student in the session's class should see a bell notification for it");
  assert.equal(sessionNotification.href, `/attend/${attendanceSession.session.id}?t=${attendanceSession.session.qrToken}`);

  const teacherCannotCheckIn = await request("/attendance/check-in", {
    method: "POST",
    headers: { Authorization: `Bearer ${teacher.token}` },
    body: JSON.stringify({ sessionId: attendanceSession.session.id, qrToken: attendanceSession.session.qrToken, nonce: "nonce-teacher", latitude: 27.2124649, longitude: 75.7002425, accuracy: 5 })
  });
  assert.equal(teacherCannotCheckIn.response.status, 403);

  const checkIn = await json("/attendance/check-in", {
    method: "POST",
    headers: { Authorization: `Bearer ${student.token}` },
    body: JSON.stringify({ sessionId: attendanceSession.session.id, qrToken: attendanceSession.session.qrToken, nonce: "nonce-1", latitude: 27.2124649, longitude: 75.7002425, accuracy: 5, deviceFingerprint: "test-device-1" })
  });
  assert.equal(checkIn.record.status, "present");
  assert.equal(checkIn.record.subjectId, quizSubject.id);

  const replayedNonce = await request("/attendance/check-in", {
    method: "POST",
    headers: { Authorization: `Bearer ${student.token}` },
    body: JSON.stringify({ sessionId: attendanceSession.session.id, qrToken: attendanceSession.session.qrToken, nonce: "nonce-1", latitude: 27.2124649, longitude: 75.7002425, accuracy: 5 })
  });
  assert.equal(replayedNonce.response.status, 409, "reusing a check-in nonce must be rejected");

  const rotated = await json(`/attendance/sessions/${attendanceSession.session.id}/rotate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${teacher.token}` }
  });
  assert.notEqual(rotated.session.qrToken, attendanceSession.session.qrToken);
  assert.ok(qrUrlPattern.test(rotated.session.qr) === false, "the rotated session.qr should carry the new token");

  // Attendance reminder emails. SMTP is unset under test, so the send
  // degrades to "recorded-no-email" - the record and the skip logic are what
  // matter here.
  const reminded = await json(`/attendance/sessions/${attendanceSession.session.id}/remind`, {
    method: "POST",
    headers: { Authorization: `Bearer ${teacher.token}` }
  });
  assert.equal(reminded.reminder.sessionId, attendanceSession.session.id);
  assert.ok(reminded.reminder.skipped >= 1, "the student who already checked in should be skipped, not emailed");
  assert.ok(!reminded.reminder.recipients || reminded.reminder.delivery === "recorded-no-email", "without SMTP the reminder is recorded rather than sent");

  const remindedList = await json(`/attendance/sessions/${attendanceSession.session.id}/reminders`, { headers: { Authorization: `Bearer ${teacher.token}` } });
  assert.equal(remindedList.reminders.length, 1);

  const studentRemind = await request(`/attendance/sessions/${attendanceSession.session.id}/remind`, {
    method: "POST",
    headers: { Authorization: `Bearer ${student.token}` }
  });
  assert.equal(studentRemind.response.status, 403, "students must not be able to trigger attendance reminder emails");

  const staleTokenCheckIn = await request("/attendance/check-in", {
    method: "POST",
    headers: { Authorization: `Bearer ${student.token}` },
    body: JSON.stringify({ sessionId: attendanceSession.session.id, qrToken: attendanceSession.session.qrToken, nonce: "nonce-2", latitude: 27.2124649, longitude: 75.7002425, accuracy: 5 })
  });
  assert.equal(staleTokenCheckIn.response.status, 409, "a rotated-away QR token must no longer be accepted");

  // Fix 5 regression test: the attendance-correction request/review workflow
  // (POST /attendance/corrections already existed and was reachable from
  // the API, but nothing in the client or the test suite exercised the
  // GET/PATCH review side - see AUDIT_REPORT.md item 5). Cover the full
  // loop: student requests a correction on their own record, a teacher
  // lists and approves it, and the underlying attendance record actually
  // changes status.
  const secondStudent = await json("/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email: "student002@example.edu",
      password: process.env.SEED_STUDENT_PASSWORD,
      role: "student"
    })
  });
  const correctionRequest = await json("/attendance/corrections", {
    method: "POST",
    headers: { Authorization: `Bearer ${student.token}` },
    body: JSON.stringify({ attendanceId: checkIn.record.id, requestedStatus: "excused", reason: "Was on approved college duty leave." })
  });
  assert.equal(correctionRequest.correction.status, "pending");
  assert.equal(correctionRequest.correction.requestedStatus, "excused");

  const otherStudentForbiddenCorrection = await request("/attendance/corrections", {
    method: "POST",
    headers: { Authorization: `Bearer ${secondStudent.token}` },
    body: JSON.stringify({ attendanceId: checkIn.record.id, requestedStatus: "present", reason: "Not my record." })
  });
  assert.equal(otherStudentForbiddenCorrection.response.status, 403, "a student must not be able to request a correction on someone else's attendance record");

  const teacherCorrectionsList = await json("/attendance/corrections", {
    headers: { Authorization: `Bearer ${teacher.token}` }
  });
  const listedCorrection = teacherCorrectionsList.corrections.find((item) => item.id === correctionRequest.correction.id);
  assert.ok(listedCorrection, "the teacher's corrections queue must include the pending request for a student they teach");
  assert.equal(listedCorrection.currentStatus, "present");
  assert.equal(listedCorrection.studentName, checkIn.record.studentName);

  const approvedCorrection = await json(`/attendance/corrections/${correctionRequest.correction.id}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${teacher.token}` },
    body: JSON.stringify({ status: "approved" })
  });
  assert.equal(approvedCorrection.correction.status, "approved");
  assert.equal(approvedCorrection.correction.resolvedBy, teacher.user.id);

  const attendanceAfterApproval = await json(`/attendance/audit?studentId=${student.user.id}`, {
    headers: { Authorization: `Bearer ${teacher.token}` }
  });
  assert.ok(
    attendanceAfterApproval.audit.some((item) => item.attendanceId === checkIn.record.id && item.next?.status === "excused"),
    "approving a correction must actually update the underlying attendance record's status"
  );

  const rejectedCorrectionSetup = await json("/attendance/corrections", {
    method: "POST",
    headers: { Authorization: `Bearer ${student.token}` },
    body: JSON.stringify({ attendanceId: checkIn.record.id, requestedStatus: "absent", reason: "Testing rejection path." })
  });
  const rejectedCorrection = await json(`/attendance/corrections/${rejectedCorrectionSetup.correction.id}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${teacher.token}` },
    body: JSON.stringify({ status: "rejected" })
  });
  assert.equal(rejectedCorrection.correction.status, "rejected");
  const attendanceAfterRejection = await json(`/attendance/audit?studentId=${student.user.id}`, {
    headers: { Authorization: `Bearer ${teacher.token}` }
  });
  assert.ok(
    !attendanceAfterRejection.audit.some((item) => item.attendanceId === checkIn.record.id && item.next?.status === "absent"),
    "rejecting a correction must not change the underlying attendance record"
  );

  // Assignments Tests
  const today = new Date();
  const dateDueToday = today.toISOString().split("T")[0];
  const dateDue3Days = new Date(today.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  const dateDue4Days = new Date(today.getTime() + 4 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

  const assignmentToday = await json("/faculty/assignments", {
    method: "POST",
    headers: { Authorization: `Bearer ${teacher.token}` },
    body: JSON.stringify({ title: "Today", className: quizClass, dueDate: dateDueToday })
  });
  const assignment3Days = await json("/faculty/assignments", {
    method: "POST",
    headers: { Authorization: `Bearer ${teacher.token}` },
    body: JSON.stringify({ title: "3 Days", className: quizClass, dueDate: dateDue3Days })
  });
  const assignment4Days = await json("/faculty/assignments", {
    method: "POST",
    headers: { Authorization: `Bearer ${teacher.token}` },
    body: JSON.stringify({ title: "4 Days", className: quizClass, dueDate: dateDue4Days })
  });

  const studentAssignments = await json("/shared/student/assignments", {
    headers: { Authorization: `Bearer ${student.token}` }
  });

  const aToday = studentAssignments.assignments.find(a => a.id === assignmentToday.assignment.id);
  const a3Days = studentAssignments.assignments.find(a => a.id === assignment3Days.assignment.id);
  const a4Days = studentAssignments.assignments.find(a => a.id === assignment4Days.assignment.id);

  assert.equal(aToday.status, "due-soon");
  assert.equal(a3Days.status, "due-soon");
  assert.equal(a4Days.status, "upcoming");

  const otherClass = teacherStudents.students.find((item) => item.className !== quizClass)?.className;
  assert.ok(otherClass, "seed data should contain another class taught by the teacher");
  const assignmentOtherClass = await json("/faculty/assignments", {
    method: "POST",
    headers: { Authorization: `Bearer ${teacher.token}` },
    body: JSON.stringify({ title: "Other Class", className: otherClass, dueDate: dateDueToday })
  });
  const badCompleteRes = await request(`/shared/student/assignments/${assignmentOtherClass.assignment.id}/complete`, {
    method: "POST",
    headers: { Authorization: `Bearer ${student.token}` }
  });
  assert.equal(badCompleteRes.response.status, 403);
  assert.equal(badCompleteRes.data.message, "This assignment is not for your class.");

  const badEditRes = await request(`/faculty/assignments/${assignmentToday.assignment.id}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${newTeacherLogin.token}` },
    body: JSON.stringify({ title: "Hacked", className: quizClass, dueDate: dateDueToday })
  });
  assert.equal(badEditRes.response.status, 404);

  const badAdminRes = await request("/admin/assignments", {
    headers: { Authorization: `Bearer ${teacher.token}` }
  });
  assert.equal(badAdminRes.response.status, 403);

  // Late assignments no longer reject completion outright — a turn-in past
  // the deadline is still accepted, just flagged "late" instead of "completed".
  const dateOverdue = new Date(today.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  const assignmentOverdue = await json("/faculty/assignments", {
    method: "POST",
    headers: { Authorization: `Bearer ${teacher.token}` },
    body: JSON.stringify({ title: "Overdue", className: quizClass, dueDate: dateOverdue })
  });
  const overdueCompleteRes = await request(`/shared/student/assignments/${assignmentOverdue.assignment.id}/complete`, {
    method: "POST",
    headers: { Authorization: `Bearer ${student.token}` }
  });
  assert.equal(overdueCompleteRes.response.status, 200);
  const overdueAssignments = await json("/shared/student/assignments", {
    headers: { Authorization: `Bearer ${student.token}` }
  });
  const lateAssignment = overdueAssignments.assignments.find(a => a.id === assignmentOverdue.assignment.id);
  assert.equal(lateAssignment.status, "late");

  // A student can attach multiple files to one submission (up to the cap).
  await json(`/shared/student/assignments/${assignmentToday.assignment.id}/complete`, {
    method: "POST",
    headers: { Authorization: `Bearer ${student.token}` },
    body: JSON.stringify({ submissionText: "First pass" })
  });
  const submissionForm = new FormData();
  submissionForm.append("files", new Blob([Buffer.from("%PDF-1.4 test")], { type: "application/pdf" }), "work.pdf");
  const uploadRes = await request(`/shared/student/assignments/${assignmentToday.assignment.id}/submission`, {
    method: "POST",
    headers: { Authorization: `Bearer ${student.token}` },
    body: submissionForm
  });
  assert.equal(uploadRes.response.status, 200);
  assert.equal(uploadRes.data.submissionFiles.length, 1);

  const secondForm = new FormData();
  secondForm.append("files", new Blob([Buffer.from("%PDF-1.4 test 2")], { type: "application/pdf" }), "work2.pdf");
  const secondUploadRes = await request(`/shared/student/assignments/${assignmentToday.assignment.id}/submission`, {
    method: "POST",
    headers: { Authorization: `Bearer ${student.token}` },
    body: secondForm
  });
  assert.equal(secondUploadRes.response.status, 200);
  assert.equal(secondUploadRes.data.submissionFiles.length, 2);

  // Once a file submission exists, text/link edits and withdrawal are locked.
  const editAfterSubmitRes = await request(`/shared/student/assignments/${assignmentToday.assignment.id}/complete`, {
    method: "POST",
    headers: { Authorization: `Bearer ${student.token}` },
    body: JSON.stringify({ submissionText: "Trying to edit after submit" })
  });
  assert.equal(editAfterSubmitRes.response.status, 409);

  const withdrawAfterSubmitRes = await request(`/shared/student/assignments/${assignmentToday.assignment.id}/complete`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${student.token}` }
  });
  assert.equal(withdrawAfterSubmitRes.response.status, 409);

  // Exceeding the 5-file cap in total (2 already submitted + 4 more) is rejected.
  const overflowForm = new FormData();
  overflowForm.append("files", new Blob([Buffer.from("%PDF-1.4 a")], { type: "application/pdf" }), "a.pdf");
  overflowForm.append("files", new Blob([Buffer.from("%PDF-1.4 b")], { type: "application/pdf" }), "b.pdf");
  overflowForm.append("files", new Blob([Buffer.from("%PDF-1.4 c")], { type: "application/pdf" }), "c.pdf");
  overflowForm.append("files", new Blob([Buffer.from("%PDF-1.4 d")], { type: "application/pdf" }), "d.pdf");
  const overflowRes = await request(`/shared/student/assignments/${assignmentToday.assignment.id}/submission`, {
    method: "POST",
    headers: { Authorization: `Bearer ${student.token}` },
    body: overflowForm
  });
  assert.equal(overflowRes.response.status, 409);

  // Teacher list must never leak password hashes, and must be staff-only.
  const studentTeachersRes = await request("/teachers", {
    headers: { Authorization: `Bearer ${student.token}` }
  });
  assert.equal(studentTeachersRes.response.status, 403);

  const staffTeachers = await json("/teachers", {
    headers: { Authorization: `Bearer ${teacher.token}` }
  });
  assert.ok(staffTeachers.teachers.length > 0);
  assert.ok(
    staffTeachers.teachers.every((item) => !("password" in item)),
    "no teacher record returned to a client should contain a password field"
  );
  assert.ok(
    !("password" in newTeacher.teacher),
    "the POST /teachers response should not echo the password hash back"
  );

  // ---- Phase 1: student profile enhancement (GET/PUT /students/me/profile) ----
  {
    const studentAuth = { Authorization: `Bearer ${student.token}` };
    const putProfile = (body, headers = studentAuth) => request("/students/me/profile", { method: "PUT", headers, body: JSON.stringify(body) });
    const secretFields = ["password", "passwordHistory", "passwordVersion"];
    const photosBefore = await json("/photos/me", { headers: studentAuth });

    // Missing / invalid authentication -> 401 on both verbs.
    assert.equal((await request("/students/me/profile")).response.status, 401);
    assert.equal((await request("/students/me/profile", { method: "PUT", body: JSON.stringify({ bio: "x" }) })).response.status, 401);
    assert.equal((await request("/students/me/profile", { headers: { Authorization: "Bearer not-a-real-token" } })).response.status, 401);

    // Authenticated non-students -> 403 on both verbs, and nothing is written.
    for (const staff of [teacher, admin]) {
      const headers = { Authorization: `Bearer ${staff.token}` };
      assert.equal((await request("/students/me/profile", { headers })).response.status, 403);
      assert.equal((await putProfile({ bio: "staff should not write this" }, headers)).response.status, 403);
    }

    // Existing records without the new fields are readable; identity comes from the token only.
    const initial = await request(`/students/me/profile?id=${encodeURIComponent("someone-else")}&studentId=someone-else`, { headers: studentAuth });
    assert.equal(initial.response.status, 200);
    assert.equal(initial.data.student.id, student.user.id);
    assert.equal(initial.data.student.email, "student001@example.edu");
    assert.ok(secretFields.every((field) => !(field in initial.data.student)));
    assert.notEqual(initial.data.student.bio, "staff should not write this");

    // Valid update: trimmed, normalised, persisted, and echoed through publicStudent().
    const valid = await putProfile({
      phone: "  +91 98765 43210  ", guardian: "  Asha Verma ", bio: "  Third-year CS student.  ",
      skills: [" React ", "Node.js", "react"], linkedin: "https://www.linkedin.com/in/student-one", github: "https://github.com/student-one",
      emergencyContactName: " Ravi Verma ", emergencyContactPhone: "+91 98765-00000"
    });
    assert.equal(valid.response.status, 200);
    assert.equal(valid.data.student.id, student.user.id);
    assert.equal(valid.data.student.phone, "+91 98765 43210");
    assert.equal(valid.data.student.guardian, "Asha Verma");
    assert.equal(valid.data.student.bio, "Third-year CS student.");
    assert.deepEqual(valid.data.student.skills, ["React", "Node.js"]);
    assert.equal(valid.data.student.linkedin, "https://www.linkedin.com/in/student-one");
    assert.equal(valid.data.student.github, "https://github.com/student-one");
    assert.equal(valid.data.student.emergencyContactName, "Ravi Verma");
    assert.equal(valid.data.student.emergencyContactPhone, "+91 98765-00000");
    assert.ok(secretFields.every((field) => !(field in valid.data.student)));
    assert.ok(!JSON.stringify(valid.data).toLowerCase().includes("password"), "PUT response must not contain password material");

    const reread = await json("/students/me/profile", { headers: studentAuth });
    assert.deepEqual(reread.student.skills, ["React", "Node.js"]);
    assert.equal(reread.student.bio, "Third-year CS student.");
    assert.ok(!JSON.stringify(reread).toLowerCase().includes("password"), "GET response must not contain password material");
    const me = await json("/auth/me", { headers: studentAuth });
    assert.equal(me.user.bio, "Third-year CS student.");
    assert.equal(me.user.role, "student");

    // Partial updates leave other fields alone; empty strings clear optional links.
    const partial = await json("/students/me/profile", { method: "PUT", headers: studentAuth, body: JSON.stringify({ github: "" }) });
    assert.equal(partial.student.github, "");
    assert.equal(partial.student.linkedin, "https://www.linkedin.com/in/student-one");
    assert.equal(partial.student.bio, "Third-year CS student.");

    // Unknown / forbidden keys -> 400 and nothing changes.
    const forbidden = ["name", "rollNumber", "className", "department", "email", "password", "approvalStatus", "photoId", "active", "id", "role", "passwordVersion", "attendancePercentage"];
    for (const key of forbidden) {
      const res = await putProfile({ bio: "should not be saved", [key]: key === "active" ? false : "tampered" });
      assert.equal(res.response.status, 400, `${key} must be rejected`);
    }
    assert.equal((await putProfile({ bio: "ok", unexpected: 1 })).response.status, 400);
    assert.equal((await putProfile({})).response.status, 400);
    assert.equal((await request("/students/me/profile", { method: "PUT", headers: studentAuth, body: JSON.stringify([{ bio: "x" }]) })).response.status, 400);

    // Field-level validation.
    for (const url of ["http://github.com/x", "javascript:alert(1)", "https://evil-github.com/x", "https://github.com.evil.example/x", "https://linkedin.com/in/x"]) {
      assert.equal((await putProfile({ github: url })).response.status, 400, `github ${url} must be rejected`);
    }
    for (const url of ["http://www.linkedin.com/in/x", "data:text/html,hi", "https://github.com/x", "https://linkedin.com.evil.example/in/x"]) {
      assert.equal((await putProfile({ linkedin: url })).response.status, 400, `linkedin ${url} must be rejected`);
    }
    const longBio = await putProfile({ bio: "b".repeat(301) });
    assert.equal(longBio.response.status, 400);
    assert.equal(longBio.data.field, "bio");
    assert.equal((await putProfile({ bio: "b".repeat(300) })).response.status, 200);
    assert.equal((await putProfile({ skills: Array.from({ length: 11 }, (_, i) => `skill${i}`) })).response.status, 400);
    assert.equal((await putProfile({ skills: Array.from({ length: 10 }, (_, i) => `skill${i}`) })).response.status, 200);
    assert.equal((await putProfile({ skills: ["x".repeat(31)] })).response.status, 400);
    assert.equal((await putProfile({ skills: "React" })).response.status, 400);
    assert.equal((await putProfile({ phone: "1".repeat(121) })).response.status, 400);
    assert.equal((await putProfile({ guardian: "g".repeat(121) })).response.status, 400);
    assert.equal((await putProfile({ emergencyContactName: "n".repeat(81) })).response.status, 400);
    assert.equal((await putProfile({ emergencyContactPhone: "1".repeat(21) })).response.status, 400);
    assert.equal((await putProfile({ emergencyContactPhone: "98765abc" })).response.status, 400);
    assert.equal((await putProfile({ bio: 12345 })).response.status, 400);

    // Rejected requests changed nothing that identity/credential/photo related.
    const afterRejects = await json("/students/me/profile", { headers: studentAuth });
    assert.equal(afterRejects.student.name, initial.data.student.name);
    assert.equal(afterRejects.student.rollNumber, initial.data.student.rollNumber);
    assert.equal(afterRejects.student.email, initial.data.student.email);
    assert.equal(afterRejects.student.approvalStatus, initial.data.student.approvalStatus);
    assert.notEqual(afterRejects.student.bio, "should not be saved");
    assert.equal(afterRejects.student.active, initial.data.student.active);

    // Photo approval workflow is untouched by profile edits, and the session still works.
    assert.deepEqual(await json("/photos/me", { headers: studentAuth }), photosBefore);
    assert.equal((await request("/students/me/status-request", { method: "POST", headers: studentAuth, body: JSON.stringify({ requestedStatus: "approved", reason: "profile test" }) })).response.status, 201);
    assert.equal((await request("/photos", { headers: studentAuth })).response.status, 403);
  }

  // ---- Phase 7: payments without a configured provider (safe not-configured state) ----
  {
    const studentAuth = { Authorization: `Bearer ${student.token}` };
    const config = await json("/payments/config", { headers: studentAuth });
    assert.equal(config.configured, false);
    assert.equal(config.keyId, null);
    assert.equal(config.mode, null);
    assert.equal((await request("/payments/config")).response.status, 401);
    const adminConfig = await json("/payments/config", { headers: { Authorization: `Bearer ${admin.token}` } });
    assert.deepEqual(adminConfig.missing, ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET"]);

    // Order creation, browser verification, and the webhook all fail closed - never "success".
    const order = await request("/payments/orders", { method: "POST", headers: studentAuth, body: JSON.stringify({ amount: 1 }) });
    assert.equal(order.response.status, 503);
    assert.equal(order.data.code, "payments_not_configured");
    const verify = await request("/payments/verify", { method: "POST", headers: studentAuth, body: JSON.stringify({ orderId: "order_x", paymentRef: "pay_x", signature: "00" }) });
    assert.equal(verify.response.status, 503);
    const webhook = await request("/payments/webhook", { method: "POST", headers: { "x-razorpay-signature": "00" }, body: JSON.stringify({ event: "payment.captured" }) });
    assert.equal(webhook.response.status, 503);

    // Fees and history keep working: nothing was created, nothing was paid.
    const mine = await json("/payments/me", { headers: studentAuth });
    assert.equal(mine.configured, false);
    assert.deepEqual(mine.payments, []);
    const history = await json("/admin/payments", { headers: { Authorization: `Bearer ${admin.token}` } });
    assert.deepEqual([history.configured, history.payments.length, history.totals.paidCount], [false, 0, 0]);
    assert.equal((await request("/payments/orders", { method: "POST", headers: { Authorization: `Bearer ${teacher.token}` }, body: "{}" })).response.status, 403);
    assert.equal((await request("/payments/orders", { method: "POST", body: "{}" })).response.status, 401);
    assert.equal((await request("/admin/payments", { headers: studentAuth })).response.status, 403);
    assert.equal((await request("/payments/00000000-0000-0000-0000-000000000000/receipt", { headers: studentAuth })).response.status, 404);
    const fees = await request("/admin/fees", { headers: { Authorization: `Bearer ${admin.token}` } });
    assert.equal(fees.response.status, 200);
    assert.ok(fees.data.studentFees.length > 0);
  }

  const weakPassword = await request("/auth/change-password", {
    method: "POST",
    headers: { Authorization: `Bearer ${student.token}` },
    body: JSON.stringify({ currentPassword: process.env.SEED_STUDENT_PASSWORD, newPassword: "too-short" })
  });
  assert.equal(weakPassword.response.status, 400);

  const changedPassword = "Student-rotated-password-2026!";
  const passwordChange = await json("/auth/change-password", {
    method: "POST",
    headers: { Authorization: `Bearer ${student.token}` },
    body: JSON.stringify({ currentPassword: process.env.SEED_STUDENT_PASSWORD, newPassword: changedPassword })
  });
  assert.equal(passwordChange.success, true);

  const expiredSession = await request("/auth/me", {
    headers: { Authorization: `Bearer ${student.token}` }
  });
  assert.equal(expiredSession.response.status, 401);

  const rotatedLogin = await json("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "student001@example.edu", password: changedPassword, role: "student" })
  });
  assert.equal(rotatedLogin.user.role, "student");

  console.log("API security smoke tests passed.");
} finally {
  server.close();
}
