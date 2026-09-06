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
  const e2eAdmin = await call("/auth/login", { method: "POST", body: JSON.stringify({ email: "admin-demo@example.edu", password: "admin-demo-2026", role: "admin" }) });
  const student = await call("/auth/login", { method: "POST", body: JSON.stringify({ email: "student001@example.edu", password: "test-student-password", role: "student" }) });
  const faculty = await call("/auth/login", { method: "POST", body: JSON.stringify({ email: "faculty-demo@example.edu", password: "faculty-demo-2026", role: "teacher" }) });
  const studentHeaders = { Authorization: `Bearer ${student.token}` };
  const adminHeaders = { Authorization: `Bearer ${admin.token}` };
  const e2eAdminHeaders = { Authorization: `Bearer ${e2eAdmin.token}` };
  const facultyHeaders = { Authorization: `Bearer ${faculty.token}` };
  const attendance = await call("/attendance", { headers: e2eAdminHeaders });
  assert.ok(Array.isArray(attendance.attendance));
  const studentRecords = await call("/students?q=student001", { headers: studentHeaders });
  assert.equal(studentRecords.students.length, 1);
  const statusRequest = await call("/students/me/status-request", { method: "POST", headers: studentHeaders, body: JSON.stringify({ requestedStatus: "approved", reason: "Please review my enrollment status." }) });
  assert.equal(statusRequest.request.status, "open");

  const createdComplaint = await call("/complaints", { method: "POST", headers: studentHeaders, body: JSON.stringify({ title: "Broken projector", category: "Classroom", description: "Projector is not working", priority: "high" }) });
  const complaints = await call("/complaints", { headers: studentHeaders });
  assert.ok(complaints.complaints.some((item) => item.id === createdComplaint.complaint.id));
  await call(`/complaints/${createdComplaint.complaint.id}`, { method: "PUT", headers: facultyHeaders, body: JSON.stringify({ status: "in-progress", response: "Faculty is reviewing this request." }) });
  const updatedComplaint = await call("/complaints", { headers: studentHeaders });
  assert.equal(updatedComplaint.complaints.find((item) => item.id === createdComplaint.complaint.id).status, "in-progress");

  const subjects = await call("/subjects", { headers: adminHeaders });
  const original = subjects.subjects.find((item) => item.subjectName === "Data Structures");
  assert.ok(original);
  await call(`/subjects/${original.id}`, { method: "PUT", headers: adminHeaders, body: JSON.stringify({ teacher: "Updated Faculty", schedule: "Tue, Thu 11:00" }) });
  const refreshed = await call("/subjects", { headers: adminHeaders });
  const updated = refreshed.subjects.find((item) => item.id === original.id);
  assert.equal(updated.teacher, "Updated Faculty");
  assert.equal(updated.schedule, "Tue, Thu 11:00");

  const schedules = await call("/schedules", { headers: adminHeaders });
  const createdSchedule = await call("/schedules", {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ day: "Tuesday", section: "CSE 3A", room: "S304", period: 2, startTime: "10:20", endTime: "11:10", subject: "TestSubject42", teacher: "DEMO" })
  });
  const scheduleAfterCreate = await call("/schedules", { headers: adminHeaders });
  assert.equal(scheduleAfterCreate.schedules.find((item) => item.id === createdSchedule.schedule.id).subject, "TestSubject42");
  await call(`/schedules/${createdSchedule.schedule.id}`, { method: "PUT", headers: adminHeaders, body: JSON.stringify({ day: "Wednesday", room: "S305", period: 3, startTime: "11:10", endTime: "12:00", subject: "TestSubject42", teacher: "DEMO" }) });
  const scheduleAfterEdit = await call("/schedules", { headers: adminHeaders });
  const editedSchedule = scheduleAfterEdit.schedules.find((item) => item.id === createdSchedule.schedule.id);
  assert.equal(editedSchedule.day, "Wednesday");
  assert.equal(editedSchedule.room, "S305");
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
