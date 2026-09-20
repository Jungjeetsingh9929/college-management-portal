process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-attendance-secret-32-chars-long";
process.env.SEED_ADMIN_EMAIL = "admin@example.edu";
process.env.SEED_ADMIN_PASSWORD = "Test-admin-password1!";
process.env.SEED_STUDENT_PASSWORD = "Test-student-password1!";
process.env.FACULTY_LRG_PASSWORD = "Test-lrg-faculty1!";
process.env.COLLEGE_LATITUDE = "27.2124649";
process.env.COLLEGE_LONGITUDE = "75.7002425";
process.env.COLLEGE_RADIUS_METERS = "300";
import assert from "node:assert/strict";
const { resetDb } = await import("../server/db/fileStore.js");
const { default: app } = await import("../server/index.js");
await resetDb();
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const base = `http://127.0.0.1:${server.address().port}/api`;
async function request(path, token, options = {}) { const response = await fetch(base + path, { ...options, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(options.headers || {}) } }); const raw = await response.text(); return { response, data: raw ? JSON.parse(raw) : {} }; }
async function login(email, password, role) { const result = await request("/auth/login", "", { method: "POST", body: JSON.stringify({ email, password, role }) }); assert.equal(result.response.status, 200); return result.data; }
try {
  const teacher = await login("lrg@example.edu", process.env.FACULTY_LRG_PASSWORD, "teacher");
  const student = await login("student001@example.edu", process.env.SEED_STUDENT_PASSWORD, "student");
  const subjects = await request("/subjects", teacher.token); const classes = await request("/faculty/students", teacher.token); const subject = subjects.data.subjects.find((item) => classes.data.classes.includes(item.className)); assert.ok(subject);
  const created = await request("/faculty/quiz-sessions", teacher.token, { method: "POST", body: JSON.stringify({ className: subject.className, subjectId: subject.id, title: "Regression session", durationMinutes: 20 }) }); assert.equal(created.response.status, 201);
  const session = created.data.session;
  const question = await request(`/faculty/quiz-sessions/${session.id}/questions`, teacher.token, { method: "POST", body: JSON.stringify({ question: "Which answer is correct?", options: ["Correct", "Wrong"], correctAnswerIndex: 0 }) }); assert.equal(question.response.status, 201); assert.equal(question.data.quiz.correctAnswerIndex, undefined);
  const opened = await request(`/shared/quiz-session/${session.id}`, student.token); assert.equal(opened.response.status, 200); assert.equal(opened.data.session.questions.length, 1); assert.equal(opened.data.session.questions[0].attempted, false);
  const closed = await request(`/faculty/quiz-sessions/${session.id}/toggle`, teacher.token, { method: "PUT" }); assert.equal(closed.response.status, 200);
  const denied = await request(`/shared/quiz-session/${session.id}`, student.token); assert.equal(denied.response.status, 400);
  console.log("QR question-session regression tests passed.");
} finally { server.close(); }
