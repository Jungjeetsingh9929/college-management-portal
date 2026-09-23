import crypto from "node:crypto";
import multer from "multer";
import { Router } from "express";
import { deleteFile, loadFile, saveFile } from "../db/blobStore.js";
import { makeId, readDb, writeDb } from "../db/fileStore.js";
import { appendAudit } from "../services/auditService.js";
import { requireAdmin, requireAuth, requireFaculty } from "../middleware/auth.js";
import { clientKey, rateConfig, rateLimit } from "../middleware/rateLimit.js";
import {
  PROJECT_GRADES,
  PROJECT_STATUSES,
  PROJECT_TYPES,
  ProjectStateError,
  allMilestonesApproved,
  assertMilestoneStatus,
  assertProjectStatus,
  canViewProject,
  deleteProjectBlobs,
  ensureProjectCollections,
  findInProgressProjectForStudent,
  isProjectGuide,
  isProjectMember,
  projectUploadRoot,
  publicProject,
  validateGuide,
  validateTeamMembers
} from "../services/projectService.js";
import { PROJECT_UPLOAD_TYPES, cleanFileName, createUploadFileFilter, extensionForMimetype, hasValidFileSignature } from "../services/uploadValidation.js";
import { enumValue, requiredText, validateKeys } from "../services/validation.js";

export const projectsRouter = Router();

const PROJECT_MAX_BYTES = Number(process.env.PROJECT_MAX_BYTES) || 15 * 1024 * 1024;

const projectUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: PROJECT_MAX_BYTES, files: 1 },
  fileFilter: createUploadFileFilter(PROJECT_UPLOAD_TYPES)
});

function parseUpload(req, res, next) {
  projectUpload.single("file")(req, res, (error) => {
    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ message: `File is too large (limit ${Math.round(PROJECT_MAX_BYTES / (1024 * 1024))} MB).` });
    }
    if (error) return res.status(400).json({ message: "Could not read the uploaded file." });
    if (!req.file) return res.status(400).json({ message: "Attach one PDF, DOCX, PNG, or JPEG file." });
    if (!hasValidFileSignature(req.file, PROJECT_UPLOAD_TYPES)) {
      return res.status(400).json({ message: "The uploaded file content does not match its declared type." });
    }
    next();
  });
}

function requireStudentRole(req, res, next) {
  if (req.user?.role !== "student") return res.status(403).json({ message: "Only students can perform this action." });
  next();
}

function buildFile(req, uploaderName) {
  const extension = extensionForMimetype(req.file.mimetype);
  const storedName = `${crypto.randomUUID()}.${extension}`;
  return {
    storedName,
    file: {
      name: cleanFileName(req.file.originalname, "project-document"),
      type: req.file.mimetype,
      size: req.file.size,
      uploadedBy: { id: req.user.id, name: uploaderName },
      uploadedAt: new Date().toISOString()
    }
  };
}

const uploadRateLimit = rateLimit({
  ...rateConfig("PROJECT_UPLOAD", { windowMs: 5 * 60 * 1000, limit: 30 }),
  message: "Too many uploads. Please try again later.",
  keyGenerator: (req) => req.user?.id || clientKey(req)
});

// Project decisions are academic outcomes with a grade attached, so they
// belong in the audit log next to marks publication (marks.publish /
// marks.unlock in routes/marks.js). appendAudit is used, not recordAudit:
// the entry must land in the same db object the handler is about to write,
// or a second readDb->writeDb cycle would race it.
function auditProject(db, req, action, project, previousValue, newValue, severity = "info") {
  appendAudit(db, {
    userId: req.user.id,
    role: req.user.role,
    action,
    severity,
    ip: req.ip,
    userAgent: req.get("user-agent"),
    target: `project:${project.id}`,
    previousValue,
    newValue
  });
}

function findProjectOr404(db, id, res) {
  const project = (db.projects || []).find((item) => item.id === id);
  if (!project) {
    res.status(404).json({ message: "Project not found." });
    return null;
  }
  return project;
}

function findMilestoneOr404(project, milestoneId, res) {
  const milestone = (project.milestones || []).find((item) => item.id === milestoneId);
  if (!milestone) {
    res.status(404).json({ message: "Milestone not found." });
    return null;
  }
  return milestone;
}

// ---- Guide directory --------------------------------------------------

projectsRouter.get("/guides", requireAuth, async (_req, res) => {
  const db = await readDb();
  const guides = (db.teachers || []).map((teacher) => ({ id: teacher.id, name: teacher.name, department: teacher.department }));
  res.json({ guides });
});

// ---- Student: my project ------------------------------------------------

projectsRouter.get("/me", requireAuth, requireStudentRole, async (req, res) => {
  const db = await readDb();
  ensureProjectCollections(db);
  const project = (db.projects || []).find((item) => isProjectMember(item, req.user.id));
  res.json({ project: project ? publicProject(project) : null });
});

const projectCreateRateLimit = rateLimit({
  ...rateConfig("PROJECT_CREATE", { windowMs: 60 * 60 * 1000, limit: 10 }),
  message: "Too many project creation attempts. Please try again later.",
  keyGenerator: (req) => req.user?.id || clientKey(req)
});

projectsRouter.post("/", requireAuth, requireStudentRole, projectCreateRateLimit, async (req, res) => {
  try {
    validateKeys(req.body || {}, ["title", "description", "type", "memberIds", "guideId"]);
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }

  const db = await readDb();
  ensureProjectCollections(db);
  const leader = (db.students || []).find((item) => item.id === req.user.id);
  if (!leader) return res.status(404).json({ message: "Student not found." });
  if (findInProgressProjectForStudent(db, leader.id)) {
    return res.status(409).json({ message: "You already have an in-progress project." });
  }

  let title, description, type, guide, memberIds;
  try {
    title = requiredText(req.body.title, "Title", { max: 160 });
    description = req.body.description === undefined ? "" : requiredText(req.body.description, "Description", { min: 0, max: 3000 });
    type = enumValue(req.body.type, "Type", PROJECT_TYPES);
    guide = validateGuide(db, String(req.body.guideId || ""));
    memberIds = validateTeamMembers(db, { leaderId: leader.id, leaderClassName: leader.className, type, memberIds: req.body.memberIds });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }

  const now = new Date().toISOString();
  const project = {
    id: makeId("proj"),
    title,
    description,
    type,
    department: leader.department,
    className: leader.className,
    leaderId: leader.id,
    memberIds,
    guideId: guide.id,
    status: "pending_guide",
    milestones: [],
    finalSubmission: null,
    finalGrade: null,
    remarks: "",
    createdAt: now,
    updatedAt: now,
    completedAt: null
  };
  db.projects.push(project);
  await writeDb(db);
  res.status(201).json({ project: publicProject(project), message: "Project submitted. Awaiting guide response." });
});

projectsRouter.put("/:id", requireAuth, requireStudentRole, async (req, res) => {
  try {
    validateKeys(req.body || {}, ["title", "description"]);
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
  const db = await readDb();
  ensureProjectCollections(db);
  const project = findProjectOr404(db, req.params.id, res);
  if (!project) return;
  if (project.leaderId !== req.user.id) return res.status(403).json({ message: "Only the project leader can edit project details." });
  if (project.status === "completed") return res.status(409).json({ message: "A completed project cannot be edited." });

  try {
    if (req.body.title !== undefined) project.title = requiredText(req.body.title, "Title", { max: 160 });
    if (req.body.description !== undefined) project.description = requiredText(req.body.description, "Description", { min: 0, max: 3000 });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
  project.updatedAt = new Date().toISOString();
  await writeDb(db);
  res.json({ project: publicProject(project), message: "Project updated." });
});

// Team membership is only editable before a guide has accepted - once the
// project is active, changing membership goes through the admin endpoint
// below, which re-validates the same server-side rules.
projectsRouter.put("/:id/members", requireAuth, requireStudentRole, async (req, res) => {
  try {
    validateKeys(req.body || {}, ["memberIds"]);
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
  const db = await readDb();
  ensureProjectCollections(db);
  const project = findProjectOr404(db, req.params.id, res);
  if (!project) return;
  if (project.leaderId !== req.user.id) return res.status(403).json({ message: "Only the project leader can change team membership." });
  try {
    assertProjectStatus(project, ["pending_guide"], "Team membership can only be changed while awaiting guide acceptance.");
  } catch (error) {
    if (error instanceof ProjectStateError) return res.status(409).json({ message: error.message });
    throw error;
  }

  let memberIds;
  try {
    // The leader itself is currently "in progress" on this very project, so
    // exclude this project from the in-progress check for its own members.
    const dbWithoutThisProject = { ...db, projects: db.projects.filter((item) => item.id !== project.id) };
    memberIds = validateTeamMembers(dbWithoutThisProject, { leaderId: project.leaderId, leaderClassName: project.className, type: project.type, memberIds: req.body.memberIds });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
  project.memberIds = memberIds;
  project.updatedAt = new Date().toISOString();
  await writeDb(db);
  res.json({ project: publicProject(project), message: "Team membership updated." });
});

// Leader proposes a (new) guide. Allowed before any guide has responded, or
// after a decline - re-proposing moves the project back into review.
projectsRouter.post("/:id/propose-guide", requireAuth, requireStudentRole, async (req, res) => {
  try {
    validateKeys(req.body || {}, ["guideId"]);
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
  const db = await readDb();
  ensureProjectCollections(db);
  const project = findProjectOr404(db, req.params.id, res);
  if (!project) return;
  if (project.leaderId !== req.user.id) return res.status(403).json({ message: "Only the project leader can propose a guide." });
  try {
    assertProjectStatus(project, ["pending_guide", "rejected"], "A guide can only be (re)proposed while pending or after a decline.");
  } catch (error) {
    if (error instanceof ProjectStateError) return res.status(409).json({ message: error.message });
    throw error;
  }

  let guide;
  try {
    guide = validateGuide(db, String(req.body.guideId || ""));
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
  project.guideId = guide.id;
  project.status = "pending_guide";
  project.updatedAt = new Date().toISOString();
  await writeDb(db);
  res.json({ project: publicProject(project), message: "Guide proposed." });
});

// ---- Guide response / admin assignment -----------------------------------

projectsRouter.post("/:id/guide/respond", requireAuth, requireFaculty, async (req, res) => {
  try {
    validateKeys(req.body || {}, ["decision", "reason"]);
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
  const db = await readDb();
  ensureProjectCollections(db);
  const project = findProjectOr404(db, req.params.id, res);
  if (!project) return;
  if (project.guideId !== req.user.id) return res.status(403).json({ message: "You have not been proposed as the guide for this project." });
  try {
    assertProjectStatus(project, ["pending_guide"], "This project is not awaiting your response.");
  } catch (error) {
    if (error instanceof ProjectStateError) return res.status(409).json({ message: error.message });
    throw error;
  }

  let decision;
  try {
    decision = enumValue(req.body.decision, "Decision", ["accept", "decline"]);
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }

  if (decision === "accept") {
    project.status = "active";
  } else {
    let reason = "";
    try {
      reason = req.body.reason ? requiredText(req.body.reason, "Reason", { min: 3, max: 500 }) : "";
    } catch (error) {
      return res.status(400).json({ message: error.message });
    }
    project.status = "rejected";
    project.remarks = reason;
  }
  project.updatedAt = new Date().toISOString();
  auditProject(db, req, "project.guide_response", project, { status: "pending_guide" }, { decision, status: project.status, reason: project.remarks || "" });
  await writeDb(db);
  res.json({ project: publicProject(project), message: decision === "accept" ? "Project accepted." : "Project declined." });
});

// Admin/HOD override: force-assigns a guide and activates the project
// immediately, regardless of current status (short of "completed"). Useful
// when a proposed guide is unavailable or a department needs to reassign.
projectsRouter.post("/:id/guide/assign", requireAuth, requireAdmin, async (req, res) => {
  try {
    validateKeys(req.body || {}, ["guideId"]);
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
  const db = await readDb();
  ensureProjectCollections(db);
  const project = findProjectOr404(db, req.params.id, res);
  if (!project) return;
  try {
    assertProjectStatus(project, ["pending_guide", "active", "rejected", "submitted"], "A completed project's guide cannot be reassigned.");
  } catch (error) {
    if (error instanceof ProjectStateError) return res.status(409).json({ message: error.message });
    throw error;
  }

  let guide;
  try {
    guide = validateGuide(db, String(req.body.guideId || ""));
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
  const beforeAssign = { guideId: project.guideId || null, status: project.status };
  project.guideId = guide.id;
  if (project.status === "pending_guide" || project.status === "rejected") project.status = "active";
  project.updatedAt = new Date().toISOString();
  // An admin overriding a guide assignment is a privileged override, so it
  // is recorded at warning severity like marks.unlock.
  auditProject(db, req, "project.guide_assigned", project, beforeAssign, { guideId: guide.id, guideName: guide.name, status: project.status }, "warning");
  await writeDb(db);
  res.json({ project: publicProject(project), message: "Guide assigned by admin." });
});

// Admin override for team membership - re-validates the same rules, but
// isn't restricted to the "pending_guide" window the student-facing route is.
projectsRouter.put("/:id/admin/members", requireAuth, requireAdmin, async (req, res) => {
  try {
    validateKeys(req.body || {}, ["memberIds"]);
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
  const db = await readDb();
  ensureProjectCollections(db);
  const project = findProjectOr404(db, req.params.id, res);
  if (!project) return;
  if (project.status === "completed") return res.status(409).json({ message: "A completed project's team cannot be changed." });

  let memberIds;
  try {
    const dbWithoutThisProject = { ...db, projects: db.projects.filter((item) => item.id !== project.id) };
    memberIds = validateTeamMembers(dbWithoutThisProject, { leaderId: project.leaderId, leaderClassName: project.className, type: project.type, memberIds: req.body.memberIds });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
  project.memberIds = memberIds;
  project.updatedAt = new Date().toISOString();
  await writeDb(db);
  res.json({ project: publicProject(project), message: "Team membership updated by admin." });
});

// ---- Milestones -----------------------------------------------------------

projectsRouter.post("/:id/milestones", requireAuth, async (req, res) => {
  try {
    validateKeys(req.body || {}, ["title", "description", "dueDate"]);
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
  const db = await readDb();
  ensureProjectCollections(db);
  const project = findProjectOr404(db, req.params.id, res);
  if (!project) return;
  if (!isProjectGuide(project, req.user) && req.user.role !== "admin") {
    return res.status(403).json({ message: "Only this project's guide or an admin can add milestones." });
  }
  try {
    assertProjectStatus(project, ["active"], "Milestones can only be added while the project is active.");
  } catch (error) {
    if (error instanceof ProjectStateError) return res.status(409).json({ message: error.message });
    throw error;
  }

  let title, description, dueDate;
  try {
    title = requiredText(req.body.title, "Title", { max: 160 });
    description = req.body.description === undefined ? "" : requiredText(req.body.description, "Description", { min: 0, max: 2000 });
    if (typeof req.body.dueDate !== "string" || Number.isNaN(new Date(req.body.dueDate).getTime())) throw new Error("Due date is invalid.");
    dueDate = req.body.dueDate;
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }

  const milestone = { id: makeId("mst"), title, description, dueDate, status: "pending", submission: null, submittedAt: null, reviewedAt: null, reviewedBy: null, remarks: "" };
  project.milestones ||= [];
  project.milestones.push(milestone);
  project.updatedAt = new Date().toISOString();
  await writeDb(db);
  res.status(201).json({ project: publicProject(project), message: "Milestone added." });
});

projectsRouter.put("/:id/milestones/:milestoneId", requireAuth, async (req, res) => {
  try {
    validateKeys(req.body || {}, ["title", "description", "dueDate"]);
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
  const db = await readDb();
  ensureProjectCollections(db);
  const project = findProjectOr404(db, req.params.id, res);
  if (!project) return;
  if (!isProjectGuide(project, req.user) && req.user.role !== "admin") {
    return res.status(403).json({ message: "Only this project's guide or an admin can edit milestones." });
  }
  const milestone = findMilestoneOr404(project, req.params.milestoneId, res);
  if (!milestone) return;
  try {
    assertMilestoneStatus(milestone, ["pending", "rejected"], "A submitted or approved milestone cannot be edited.");
  } catch (error) {
    if (error instanceof ProjectStateError) return res.status(409).json({ message: error.message });
    throw error;
  }

  try {
    if (req.body.title !== undefined) milestone.title = requiredText(req.body.title, "Title", { max: 160 });
    if (req.body.description !== undefined) milestone.description = requiredText(req.body.description, "Description", { min: 0, max: 2000 });
    if (req.body.dueDate !== undefined) {
      if (typeof req.body.dueDate !== "string" || Number.isNaN(new Date(req.body.dueDate).getTime())) throw new Error("Due date is invalid.");
      milestone.dueDate = req.body.dueDate;
    }
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
  project.updatedAt = new Date().toISOString();
  await writeDb(db);
  res.json({ project: publicProject(project), message: "Milestone updated." });
});

projectsRouter.delete("/:id/milestones/:milestoneId", requireAuth, async (req, res) => {
  const db = await readDb();
  ensureProjectCollections(db);
  const project = findProjectOr404(db, req.params.id, res);
  if (!project) return;
  if (!isProjectGuide(project, req.user) && req.user.role !== "admin") {
    return res.status(403).json({ message: "Only this project's guide or an admin can remove milestones." });
  }
  const milestone = findMilestoneOr404(project, req.params.milestoneId, res);
  if (!milestone) return;
  if (project.status === "completed") return res.status(409).json({ message: "A completed project's milestones cannot be changed." });

  const staleStoredName = milestone.submission?.storedName;
  project.milestones = project.milestones.filter((item) => item.id !== milestone.id);
  project.updatedAt = new Date().toISOString();
  await writeDb(db);
  // Record is gone first; a failed blob cleanup only leaves an unreachable file.
  await deleteProjectBlobs([staleStoredName]);
  res.json({ project: publicProject(project), message: "Milestone removed." });
});

const submitRateLimit = rateLimit({
  ...rateConfig("PROJECT_SUBMISSION", { windowMs: 5 * 60 * 1000, limit: 20 }),
  message: "Too many submission attempts. Please try again later.",
  keyGenerator: (req) => req.user?.id || clientKey(req)
});

// Any team member (leader or teammate) may submit on the team's behalf.
projectsRouter.post("/:id/milestones/:milestoneId/submission", requireAuth, requireStudentRole, uploadRateLimit, submitRateLimit, parseUpload, async (req, res) => {
  const db = await readDb();
  ensureProjectCollections(db);
  const project = findProjectOr404(db, req.params.id, res);
  if (!project) return;
  if (!isProjectMember(project, req.user.id)) return res.status(403).json({ message: "You are not a member of this project." });
  const milestone = findMilestoneOr404(project, req.params.milestoneId, res);
  if (!milestone) return;

  try {
    assertProjectStatus(project, ["active"], "Submissions are only accepted while the project is active.");
    assertMilestoneStatus(milestone, ["pending", "rejected"], "This milestone has already been submitted or approved.");
  } catch (error) {
    if (error instanceof ProjectStateError) return res.status(409).json({ message: error.message });
    throw error;
  }

  const { storedName, file } = buildFile(req, req.user.name);
  const staleStoredName = milestone.submission?.storedName;
  await saveFile({ storedName, buffer: req.file.buffer, localDir: projectUploadRoot });

  try {
    milestone.submission = { ...file, storedName };
    milestone.status = "submitted";
    milestone.submittedAt = file.uploadedAt;
    milestone.reviewedAt = null;
    milestone.reviewedBy = null;
    milestone.remarks = "";
    project.updatedAt = new Date().toISOString();
    await writeDb(db);
  } catch (error) {
    await deleteFile({ storedName, localDir: projectUploadRoot }).catch(() => {});
    throw error;
  }
  await deleteProjectBlobs([staleStoredName]);
  res.json({ project: publicProject(project), message: "Milestone submitted for review." });
});

projectsRouter.get("/:id/milestones/:milestoneId/file", requireAuth, async (req, res) => {
  const db = await readDb();
  ensureProjectCollections(db);
  const project = findProjectOr404(db, req.params.id, res);
  if (!project) return;
  if (!canViewProject(project, req.user)) return res.status(403).json({ message: "You do not have access to this project's documents." });
  const milestone = findMilestoneOr404(project, req.params.milestoneId, res);
  if (!milestone) return;
  if (!milestone.submission?.storedName) return res.status(404).json({ message: "No submission file found." });

  const buffer = await loadFile({ storedName: milestone.submission.storedName, localDir: projectUploadRoot });
  if (!buffer) return res.status(404).json({ message: "File not found." });
  res.set("Content-Type", milestone.submission.type || "application/octet-stream");
  res.set("X-Content-Type-Options", "nosniff");
  res.attachment(milestone.submission.name || "milestone-submission");
  res.send(buffer);
});

projectsRouter.post("/:id/milestones/:milestoneId/review", requireAuth, async (req, res) => {
  try {
    validateKeys(req.body || {}, ["decision", "remarks"]);
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
  const db = await readDb();
  ensureProjectCollections(db);
  const project = findProjectOr404(db, req.params.id, res);
  if (!project) return;
  if (!isProjectGuide(project, req.user) && req.user.role !== "admin") {
    return res.status(403).json({ message: "Only this project's guide or an admin can review milestones." });
  }
  const milestone = findMilestoneOr404(project, req.params.milestoneId, res);
  if (!milestone) return;
  try {
    assertMilestoneStatus(milestone, ["submitted"], "This milestone has no pending submission to review.");
  } catch (error) {
    if (error instanceof ProjectStateError) return res.status(409).json({ message: error.message });
    throw error;
  }

  let decision, remarks;
  try {
    decision = enumValue(req.body.decision, "Decision", ["approve", "reject"]);
    remarks = decision === "reject"
      ? requiredText(req.body.remarks, "Remarks", { min: 3, max: 1000 })
      : (req.body.remarks === undefined ? "" : requiredText(req.body.remarks, "Remarks", { min: 0, max: 1000 }));
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }

  milestone.status = decision === "approve" ? "approved" : "rejected";
  milestone.reviewedAt = new Date().toISOString();
  milestone.reviewedBy = { id: req.user.id, name: req.user.name };
  milestone.remarks = remarks;
  project.updatedAt = new Date().toISOString();
  auditProject(db, req, "project.milestone_review", project, { milestoneId: milestone.id, status: "submitted" }, { milestoneId: milestone.id, title: milestone.title || "", decision, status: milestone.status });
  await writeDb(db);
  res.json({ project: publicProject(project), message: decision === "approve" ? "Milestone approved." : "Milestone sent back for revision." });
});

// ---- Final submission & review --------------------------------------------

projectsRouter.post("/:id/final-submission", requireAuth, requireStudentRole, uploadRateLimit, submitRateLimit, parseUpload, async (req, res) => {
  const db = await readDb();
  ensureProjectCollections(db);
  const project = findProjectOr404(db, req.params.id, res);
  if (!project) return;
  if (!isProjectMember(project, req.user.id)) return res.status(403).json({ message: "You are not a member of this project." });
  try {
    assertProjectStatus(project, ["active"], "The final report can only be submitted while the project is active.");
  } catch (error) {
    if (error instanceof ProjectStateError) return res.status(409).json({ message: error.message });
    throw error;
  }
  if (!allMilestonesApproved(project)) {
    return res.status(409).json({ message: "All milestones must be approved before the final report can be submitted." });
  }

  const { storedName, file } = buildFile(req, req.user.name);
  const staleStoredName = project.finalSubmission?.storedName;
  await saveFile({ storedName, buffer: req.file.buffer, localDir: projectUploadRoot });

  try {
    project.finalSubmission = { ...file, storedName };
    project.status = "submitted";
    project.updatedAt = new Date().toISOString();
    await writeDb(db);
  } catch (error) {
    await deleteFile({ storedName, localDir: projectUploadRoot }).catch(() => {});
    throw error;
  }
  await deleteProjectBlobs([staleStoredName]);
  res.json({ project: publicProject(project), message: "Final report submitted for review." });
});

projectsRouter.get("/:id/final-submission/file", requireAuth, async (req, res) => {
  const db = await readDb();
  ensureProjectCollections(db);
  const project = findProjectOr404(db, req.params.id, res);
  if (!project) return;
  if (!canViewProject(project, req.user)) return res.status(403).json({ message: "You do not have access to this project's documents." });
  if (!project.finalSubmission?.storedName) return res.status(404).json({ message: "No final submission file found." });

  const buffer = await loadFile({ storedName: project.finalSubmission.storedName, localDir: projectUploadRoot });
  if (!buffer) return res.status(404).json({ message: "File not found." });
  res.set("Content-Type", project.finalSubmission.type || "application/octet-stream");
  res.set("X-Content-Type-Options", "nosniff");
  res.attachment(project.finalSubmission.name || "final-submission");
  res.send(buffer);
});

projectsRouter.post("/:id/review", requireAuth, async (req, res) => {
  try {
    validateKeys(req.body || {}, ["decision", "grade", "remarks"]);
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
  const db = await readDb();
  ensureProjectCollections(db);
  const project = findProjectOr404(db, req.params.id, res);
  if (!project) return;
  if (!isProjectGuide(project, req.user) && req.user.role !== "admin") {
    return res.status(403).json({ message: "Only this project's guide or an admin can give a final review." });
  }
  try {
    assertProjectStatus(project, ["submitted"], "This project has no final submission awaiting review.");
  } catch (error) {
    if (error instanceof ProjectStateError) return res.status(409).json({ message: error.message });
    throw error;
  }

  let decision, grade, remarks;
  try {
    decision = enumValue(req.body.decision, "Decision", ["approve", "revise"]);
    if (decision === "approve") {
      grade = enumValue(req.body.grade, "Grade", PROJECT_GRADES);
      remarks = req.body.remarks === undefined ? "" : requiredText(req.body.remarks, "Remarks", { min: 0, max: 1000 });
    } else {
      remarks = requiredText(req.body.remarks, "Remarks", { min: 3, max: 1000 });
    }
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }

  const previousState = { status: project.status, finalGrade: project.finalGrade || null };
  if (decision === "approve") {
    project.status = "completed";
    project.finalGrade = grade;
    project.remarks = remarks;
    project.completedAt = new Date().toISOString();
  } else {
    project.status = "active";
    project.remarks = remarks;
  }
  project.updatedAt = new Date().toISOString();
  auditProject(db, req, "project.review", project, previousState, { decision, status: project.status, finalGrade: project.finalGrade || null, remarks: remarks || "" });
  await writeDb(db);
  res.json({ project: publicProject(project), message: decision === "approve" ? "Project graded and completed." : "Project sent back for revision." });
});

// ---- Listing / admin --------------------------------------------------

projectsRouter.get("/guide/mine", requireAuth, requireFaculty, async (req, res) => {
  const db = await readDb();
  ensureProjectCollections(db);
  const items = (db.projects || []).filter((item) => item.guideId === req.user.id).map(publicProject);
  res.json({ items });
});

projectsRouter.get("/", requireAuth, requireAdmin, async (req, res) => {
  const db = await readDb();
  ensureProjectCollections(db);
  let items = db.projects || [];
  if (req.query.status) {
    if (!PROJECT_STATUSES.includes(String(req.query.status))) return res.status(400).json({ message: "Status filter is invalid." });
    items = items.filter((item) => item.status === req.query.status);
  }
  if (req.query.department) items = items.filter((item) => item.department === req.query.department);
  if (req.query.guideId) items = items.filter((item) => item.guideId === req.query.guideId);
  items = [...items].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).map(publicProject);
  res.json({
    items,
    stats: {
      total: db.projects.length,
      byStatus: Object.fromEntries(PROJECT_STATUSES.map((status) => [status, db.projects.filter((item) => item.status === status).length]))
    }
  });
});

projectsRouter.get("/:id", requireAuth, async (req, res) => {
  const db = await readDb();
  ensureProjectCollections(db);
  const project = findProjectOr404(db, req.params.id, res);
  if (!project) return;
  if (!canViewProject(project, req.user)) return res.status(403).json({ message: "You do not have access to this project." });
  res.json({ project: publicProject(project) });
});

projectsRouter.delete("/:id", requireAuth, requireAdmin, async (req, res) => {
  const db = await readDb();
  ensureProjectCollections(db);
  const project = findProjectOr404(db, req.params.id, res);
  if (!project) return;

  const staleStoredNames = [project.finalSubmission?.storedName, ...(project.milestones || []).map((milestone) => milestone.submission?.storedName)];
  db.projects = db.projects.filter((item) => item.id !== project.id);
  await writeDb(db);
  // Record is gone first; a failed blob cleanup only leaves an unreachable file.
  await deleteProjectBlobs(staleStoredNames);
  res.json({ success: true, message: "Project deleted." });
});
