process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-attendance-secret-32-chars-long";
process.env.SEED_ADMIN_EMAIL = "admin@example.edu";
process.env.SEED_ADMIN_PASSWORD = "test-admin-password";
process.env.SEED_STUDENT_PASSWORD = "test-student-password";
process.env.E2E_FACULTY_PASSWORD = "test-e2e-faculty-password";
process.env.E2E_ADMIN_PASSWORD = "test-e2e-admin-password";
process.env.DEMO_LOGIN_PASSWORD = "test-demo-login-password";
process.env.FACULTY_LRG_PASSWORD = "test-lrg-faculty-password";
process.env.COLLEGE_LATITUDE = "27.2124649";
process.env.COLLEGE_LONGITUDE = "75.7002425";
process.env.COLLEGE_RADIUS_METERS = "300";

import assert from "node:assert/strict";

const { resetDb } = await import("../server/db/fileStore.js");
const { default: app } = await import("../server/index.js");
await resetDb();

const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}/api`;

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
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

  const student = await json("/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email: "student001@example.edu",
      password: process.env.SEED_STUDENT_PASSWORD,
      role: "student"
    })
  });
  assert.equal(student.user.role, "student");

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
      password: "teacher-demo-password",
      subjects: []
    })
  });
  const newTeacherLogin = await json("/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email: "teacher-demo@example.edu",
      password: "teacher-demo-password",
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

  const weakPassword = await request("/auth/change-password", {
    method: "POST",
    headers: { Authorization: `Bearer ${student.token}` },
    body: JSON.stringify({ currentPassword: process.env.SEED_STUDENT_PASSWORD, newPassword: "too-short" })
  });
  assert.equal(weakPassword.response.status, 400);

  const changedPassword = "student-rotated-password-2026";
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
