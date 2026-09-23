process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-round10-scope-secret-32-chars-long";
process.env.SEED_ADMIN_EMAIL = "admin@example.edu";
process.env.SEED_ADMIN_PASSWORD = "Test-admin-password1!";
process.env.SEED_STUDENT_PASSWORD = "Test-student-password1!";
process.env.FACULTY_LRG_PASSWORD = "Test-lrg-faculty1!";

import assert from "node:assert/strict";
const { resetDb } = await import("../server/db/fileStore.js");
const { default: app } = await import("../server/index.js");
await resetDb();
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const base = `http://127.0.0.1:${server.address().port}/api`;
async function request(path, token, options = {}) {
  const response = await fetch(base + path, { ...options, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) } });
  const raw = await response.text();
  return { response, data: raw && (response.headers.get("content-type") || "").includes("json") ? JSON.parse(raw) : {} };
}
async function login(email, password, role) {
  const result = await request("/auth/login", "", { method: "POST", body: JSON.stringify({ email, password, role }) });
  assert.equal(result.response.status, 200);
  return result.data;
}
try {
  const admin = await login("admin@example.edu", process.env.SEED_ADMIN_PASSWORD, "admin");
  const badDepartment = await request("/admin/departments", admin.token, { method: "POST", body: JSON.stringify({ name: "Invalid HOD Department", hodId: "teacher-does-not-exist" }) });
  assert.equal(badDepartment.response.status, 400, "department creation must reject dangling HOD IDs");
  const student = await login("student001@example.edu", process.env.SEED_STUDENT_PASSWORD, "student");
  const teacher = await login("lrg@example.edu", process.env.FACULTY_LRG_PASSWORD, "teacher");

  const allSubjects = await request("/subjects", admin.token);
  const studentSubjects = await request("/subjects", student.token);
  assert.ok(studentSubjects.data.subjects.every((item) => item.className === "CSE 3A"), "student subject catalog must be class-scoped");
  assert.ok(studentSubjects.data.subjects.length < allSubjects.data.subjects.length, "student subject catalog should not expose every class");

  const studentSchedule = await request("/schedules", student.token);
  assert.ok(studentSchedule.data.schedules.every((item) => item.section === "CSE 3A"), "student schedule rows must be class-scoped");
  assert.ok(studentSchedule.data.sections.every((section) => section === "CSE 3A"), "student schedule filter metadata must be class-scoped");
  assert.ok(studentSchedule.data.faculty.every((faculty) => studentSchedule.data.schedules.some((item) => item.teacher === faculty)), "student faculty filters must match visible rows");

  const teacherSubjects = await request("/subjects", teacher.token);
  const teacherSubjectIds = new Set(teacherSubjects.data.subjects.map((item) => item.id));
  const unassigned = allSubjects.data.subjects.find((item) => item.className === "CSE 3A" && !teacherSubjectIds.has(item.id));
  if (unassigned) {
    const search = await request(`/shared/search?q=${encodeURIComponent(unassigned.subjectName)}`, teacher.token);
    assert.ok(!search.data.results.some((item) => item.id === unassigned.id), "faculty search must not expose an unassigned subject");
  }

  console.log("Round 10 scope regression tests passed.");
} finally { server.close(); }
