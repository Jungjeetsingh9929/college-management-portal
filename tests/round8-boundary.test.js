process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-attendance-secret-32-chars-long";
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
  const admin = await login(process.env.SEED_ADMIN_EMAIL, process.env.SEED_ADMIN_PASSWORD, "admin");
  const badEvent = await request("/events", admin.token, { method: "POST", body: JSON.stringify({ title: "Bad date", category: "Academic", startDate: "2026-02-31", endDate: "2026-02-31" }) });
  assert.equal(badEvent.response.status, 400);
  const badSchedule = await request("/schedules", admin.token, { method: "POST", body: JSON.stringify({ day: "Monday", section: "CSE-A", period: 1, startTime: "12:00", endTime: "11:00", subject: "Test", teacher: "Teacher", room: "R1" }) });
  assert.equal(badSchedule.response.status, 400);
  const subjects = await request("/subjects", admin.token);
  const badClass = await request("/subjects/classes", admin.token, { method: "POST", body: JSON.stringify({ subjectId: "sub-does-not-exist", className: "CSE-A", day: "Monday", startTime: "09:00", endTime: "10:00" }) });
  assert.equal(badClass.response.status, 404);
  const teacher = await login("lrg@example.edu", process.env.FACULTY_LRG_PASSWORD, "teacher");
  const correction = await request("/attendance/corrections", teacher.token, { method: "POST", body: JSON.stringify({ attendanceId: "att-does-not-exist", requestedStatus: "present", reason: "test" }) });
  assert.equal(correction.response.status, 400);
  console.log("Round 8 boundary regression tests passed.");
} finally { server.close(); }
