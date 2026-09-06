process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-attendance-secret-32-chars-long";
process.env.SEED_ADMIN_EMAIL = "admin@example.edu";
process.env.SEED_ADMIN_PASSWORD = "test-admin-password";
process.env.SEED_STUDENT_PASSWORD = "test-student-password";

import assert from "node:assert/strict";
const { resetDb } = await import("../server/db/fileStore.js");
const { default: app } = await import("../server/index.js");
await resetDb();
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const base = `http://127.0.0.1:${server.address().port}/api`;
async function call(path, options = {}) {
  const response = await fetch(`${base}${path}`, { ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) } });
  const data = await response.json();
  assert.ok(response.ok, `${path}: ${data.message || response.status}`);
  return data;
}
try {
  const admin = await call("/auth/login", { method: "POST", body: JSON.stringify({ email: "admin@example.edu", password: "test-admin-password", role: "admin" }) });
  const student = await call("/auth/login", { method: "POST", body: JSON.stringify({ email: "student001@example.edu", password: "test-student-password", role: "student" }) });
  const faculty = await call("/auth/login", { method: "POST", body: JSON.stringify({ email: "faculty-demo@example.edu", password: "faculty-demo-2026", role: "teacher" }) });
  const studentHeaders = { Authorization: `Bearer ${student.token}` };
  const adminHeaders = { Authorization: `Bearer ${admin.token}` };
  const facultyHeaders = { Authorization: `Bearer ${faculty.token}` };

  const createdComplaint = await call("/complaints", { method: "POST", headers: studentHeaders, body: JSON.stringify({ title: "Broken projector", category: "Classroom", description: "Projector is not working", priority: "high" }) });
  const complaints = await call("/complaints", { headers: studentHeaders });
  assert.ok(complaints.complaints.some((item) => item.id === createdComplaint.complaint.id));

  const subjects = await call("/subjects", { headers: adminHeaders });
  const original = subjects.subjects.find((item) => item.subjectName === "Data Structures");
  assert.ok(original);
  await call(`/subjects/${original.id}`, { method: "PUT", headers: adminHeaders, body: JSON.stringify({ teacher: "Updated Faculty", schedule: "Tue, Thu 11:00" }) });
  const refreshed = await call("/subjects", { headers: adminHeaders });
  const updated = refreshed.subjects.find((item) => item.id === original.id);
  assert.equal(updated.teacher, "Updated Faculty");
  assert.equal(updated.schedule, "Tue, Thu 11:00");

  const schedules = await call("/schedules", { headers: adminHeaders });
  const target = schedules.schedules.find((item) => item.id === "sch-e2e-demo-monday-1");
  assert.ok(target);
  await call(`/schedules/${target.id}`, { method: "DELETE", headers: adminHeaders });
  const afterDelete = await call("/schedules", { headers: adminHeaders });
  assert.ok(!afterDelete.schedules.some((item) => item.id === target.id));

  const facultySchedule = await call("/faculty/schedule", { headers: facultyHeaders });
  assert.ok(facultySchedule.schedules.some((item) => item.teacher === "DEMO"));
  console.log("Focused regression flows passed.");
} finally {
  server.close();
}
