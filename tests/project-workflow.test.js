// Exercises the Phase 4 final-year-project flow end to end and checks its
// exit gate: unauthorized users cannot reach project documents, invalid
// status changes are rejected, a failed upload never leaves an orphan blob,
// and none of this touches examinations/results/fee records.
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-attendance-secret-32-chars-long";
process.env.SEED_ADMIN_EMAIL = "admin@example.edu";
process.env.SEED_ADMIN_PASSWORD = "Test-admin-password1!";
process.env.SEED_STUDENT_PASSWORD = "Test-student-password1!";
process.env.E2E_FACULTY_PASSWORD = "Test-e2e-faculty1!";
process.env.E2E_ADMIN_PASSWORD = "Test-e2e-admin1!";
process.env.PUBLIC_API_LIMIT = "2000";

import assert from "node:assert/strict";
import fs from "node:fs/promises";

const { resetDb } = await import("../server/db/fileStore.js");
const { default: app } = await import("../server/index.js");
const { projectUploadRoot } = await import("../server/services/projectService.js");
await resetDb();

const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const base = `http://127.0.0.1:${server.address().port}/api`;

async function call(path, options = {}) {
  const isForm = options.body instanceof FormData;
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: { ...(isForm ? {} : { "Content-Type": "application/json" }), ...(options.headers || {}) }
  });
  const raw = await response.text();
  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json") && raw ? JSON.parse(raw) : {};
  return { response, data };
}

async function ok(path, options = {}) {
  const { response, data } = await call(path, options);
  assert.ok(response.ok, `${path}: ${data.message || response.status}`);
  return data;
}

function pdfFile(name = "report.pdf") {
  const body = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(64, 1)]);
  return new File([body], name, { type: "application/pdf" });
}

try {
  const login = (email, password, role) => ok("/auth/login", { method: "POST", body: JSON.stringify({ email, password, role }) });

  const admin = await login(process.env.SEED_ADMIN_EMAIL, process.env.SEED_ADMIN_PASSWORD, "admin");
  const leader = await login("student001@example.edu", process.env.SEED_STUDENT_PASSWORD, "student");
  const teammate = await login("student002@example.edu", process.env.SEED_STUDENT_PASSWORD, "student");
  const outsider = await login("student003@example.edu", process.env.SEED_STUDENT_PASSWORD, "student");
  const guide = await login("faculty-demo@example.edu", process.env.E2E_FACULTY_PASSWORD, "teacher");

  const adminH = { Authorization: `Bearer ${admin.token}` };
  const leaderH = { Authorization: `Bearer ${leader.token}` };
  const teammateH = { Authorization: `Bearer ${teammate.token}` };
  const outsiderH = { Authorization: `Bearer ${outsider.token}` };
  const guideH = { Authorization: `Bearer ${guide.token}` };

  // ---- Guide directory is visible to a student -----------------------
  const guides = await ok("/projects/guides", { headers: leaderH });
  assert.ok(guides.guides.some((item) => item.id === guide.user.id));

  // ---- Team creation: server-side membership validation ----------------
  // Not in leader's class -> rejected server-side even though the client asked for it.
  const badTeam = await call("/projects", {
    method: "POST",
    headers: leaderH,
    body: JSON.stringify({ title: "Smart Campus", description: "IoT campus system", type: "team", memberIds: ["stu-100"], guideId: guide.user.id })
  });
  assert.equal(badTeam.response.status, 400);

  const project = await ok("/projects", {
    method: "POST",
    headers: leaderH,
    body: JSON.stringify({ title: "Smart Campus", description: "IoT campus system", type: "team", memberIds: [teammate.user.id], guideId: guide.user.id })
  });
  assert.equal(project.project.status, "pending_guide");
  const projectId = project.project.id;

  // A teammate already on an in-progress team cannot be double-booked onto a second one.
  const doubleBooked = await call("/projects", {
    method: "POST",
    headers: outsiderH,
    body: JSON.stringify({ title: "Second Team", type: "team", memberIds: [teammate.user.id], guideId: guide.user.id })
  });
  assert.equal(doubleBooked.response.status, 400);

  // ---- Invalid status changes are rejected ------------------------------
  // Milestones cannot be added before the guide has accepted (status is still "pending_guide").
  const earlyMilestone = await call(`/projects/${projectId}/milestones`, {
    method: "POST",
    headers: guideH,
    body: JSON.stringify({ title: "Literature review", dueDate: "2026-11-01" })
  });
  assert.equal(earlyMilestone.response.status, 409);

  // A non-guide teacher cannot accept/decline someone else's proposal.
  const wrongGuideRespond = await call(`/projects/${projectId}/guide/respond`, {
    method: "POST",
    headers: adminH, // admin isn't a teacher at all
    body: JSON.stringify({ decision: "accept" })
  });
  assert.equal(wrongGuideRespond.response.status, 403);

  const accepted = await ok(`/projects/${projectId}/guide/respond`, {
    method: "POST",
    headers: guideH,
    body: JSON.stringify({ decision: "accept" })
  });
  assert.equal(accepted.project.status, "active");

  // Guide cannot accept twice - status no longer "pending_guide".
  const doubleAccept = await call(`/projects/${projectId}/guide/respond`, {
    method: "POST",
    headers: guideH,
    body: JSON.stringify({ decision: "accept" })
  });
  assert.equal(doubleAccept.response.status, 409);

  const milestone = await ok(`/projects/${projectId}/milestones`, {
    method: "POST",
    headers: guideH,
    body: JSON.stringify({ title: "Literature review", description: "Survey prior work", dueDate: "2026-11-01" })
  });
  const milestoneId = milestone.project.milestones[0].id;

  // Final submission is blocked while an unapproved milestone exists.
  const earlyFinal = await call(`/projects/${projectId}/final-submission`, {
    method: "POST",
    headers: leaderH,
    body: (() => { const f = new FormData(); f.append("file", pdfFile("final.pdf")); return f; })()
  });
  assert.equal(earlyFinal.response.status, 409);

  // ---- Failed upload leaves no orphan blob ------------------------------
  const beforeFiles = await fs.readdir(projectUploadRoot).catch(() => []);
  const badTypeForm = new FormData();
  badTypeForm.append("file", new File([Buffer.from("plain text")], "notes.txt", { type: "text/plain" }));
  const rejectedUpload = await call(`/projects/${projectId}/milestones/${milestoneId}/submission`, {
    method: "POST",
    headers: teammateH,
    body: badTypeForm
  });
  assert.equal(rejectedUpload.response.status, 400);
  const afterRejected = await fs.readdir(projectUploadRoot).catch(() => []);
  assert.deepEqual(afterRejected.sort(), beforeFiles.sort(), "a rejected upload must not leave a stored blob behind");

  // A team member (not just the leader) may submit on the team's behalf.
  const submission = await ok(`/projects/${projectId}/milestones/${milestoneId}/submission`, {
    method: "POST",
    headers: teammateH,
    body: (() => { const f = new FormData(); f.append("file", pdfFile("milestone1.pdf")); return f; })()
  });
  assert.equal(submission.project.milestones[0].status, "submitted");
  assert.equal(submission.project.milestones[0].submission.storedName, undefined, "storedName must never reach the client");

  // ---- Unauthorized users cannot access project documents ---------------
  const unauthorizedDownload = await call(`/projects/${projectId}/milestones/${milestoneId}/file`, { headers: outsiderH });
  assert.equal(unauthorizedDownload.response.status, 403);

  const memberDownload = await call(`/projects/${projectId}/milestones/${milestoneId}/file`, { headers: leaderH });
  assert.equal(memberDownload.response.status, 200);
  assert.equal(memberDownload.response.headers.get("content-type"), "application/pdf");

  const guideDownload = await call(`/projects/${projectId}/milestones/${milestoneId}/file`, { headers: guideH });
  assert.equal(guideDownload.response.status, 200);

  const adminDownload = await call(`/projects/${projectId}/milestones/${milestoneId}/file`, { headers: adminH });
  assert.equal(adminDownload.response.status, 200);

  // A non-guide teacher cannot review someone else's milestone.
  const otherTeacherLogin = await login("a@example.edu", "A@Uem2026", "teacher").catch(() => null);
  if (otherTeacherLogin) {
    const otherTeacherReview = await call(`/projects/${projectId}/milestones/${milestoneId}/review`, {
      method: "POST",
      headers: { Authorization: `Bearer ${otherTeacherLogin.token}` },
      body: JSON.stringify({ decision: "approve" })
    });
    assert.equal(otherTeacherReview.response.status, 403);
  }

  // Reviewing an already-approved milestone again is an invalid transition.
  const approved = await ok(`/projects/${projectId}/milestones/${milestoneId}/review`, {
    method: "POST",
    headers: guideH,
    body: JSON.stringify({ decision: "approve", remarks: "Good start." })
  });
  assert.equal(approved.project.milestones[0].status, "approved");
  const reReview = await call(`/projects/${projectId}/milestones/${milestoneId}/review`, {
    method: "POST",
    headers: guideH,
    body: JSON.stringify({ decision: "approve" })
  });
  assert.equal(reReview.response.status, 409);

  // ---- Final submission + guide review + grade --------------------------
  const finalSubmission = await ok(`/projects/${projectId}/final-submission`, {
    method: "POST",
    headers: leaderH,
    body: (() => { const f = new FormData(); f.append("file", pdfFile("final.pdf")); return f; })()
  });
  assert.equal(finalSubmission.project.status, "submitted");

  // Grade is a controlled enum, not free text.
  const badGrade = await call(`/projects/${projectId}/review`, {
    method: "POST",
    headers: guideH,
    body: JSON.stringify({ decision: "approve", grade: "Excellent!!", remarks: "Great work." })
  });
  assert.equal(badGrade.response.status, 400);

  const graded = await ok(`/projects/${projectId}/review`, {
    method: "POST",
    headers: guideH,
    body: JSON.stringify({ decision: "approve", grade: "A", remarks: "Excellent execution and documentation." })
  });
  assert.equal(graded.project.status, "completed");
  assert.equal(graded.project.finalGrade, "A");

  // A completed project cannot be edited or have its guide reassigned.
  const editCompleted = await call(`/projects/${projectId}`, { method: "PUT", headers: leaderH, body: JSON.stringify({ title: "New title" }) });
  assert.equal(editCompleted.response.status, 409);
  const reassignCompleted = await call(`/projects/${projectId}/guide/assign`, { method: "POST", headers: adminH, body: JSON.stringify({ guideId: guide.user.id }) });
  assert.equal(reassignCompleted.response.status, 409);

  // ---- Admin delete cleans up every stored blob --------------------------
  const filesBeforeDelete = await fs.readdir(projectUploadRoot).catch(() => []);
  assert.ok(filesBeforeDelete.length >= 2, "expected the milestone + final submission blobs to exist");
  await ok(`/projects/${projectId}`, { method: "DELETE", headers: adminH });
  const filesAfterDelete = await fs.readdir(projectUploadRoot).catch(() => []);
  assert.equal(filesAfterDelete.length, 0, "deleting a project must remove all of its document blobs");

  // ---- Works with no exam or payment records -----------------------------
  const db = await (await import("../server/db/fileStore.js")).readDb();
  assert.equal((db.examinations || []).length, 0, "seed data has no examinations, and the project flow above never created any");
  assert.equal((db.results || []).length, 0, "project workflow must not depend on or create exam results");
  // The flow above never touched fee/payment collections either.
  assert.equal((db.studentFees || []).length, 0);

  console.log("project-workflow tests passed");
} finally {
  server.close();
}
