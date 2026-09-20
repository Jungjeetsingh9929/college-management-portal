import path from "node:path";
import { deleteFile } from "../db/blobStore.js";

// ---- Constants --------------------------------------------------------

export const PROJECT_TYPES = ["individual", "team"];

// Explicit status machine. Every transition below happens through its own
// dedicated endpoint (propose guide / accept / decline / assign / submit /
// review) rather than a generic "PATCH status" field, so an invalid jump
// (e.g. "completed" -> "active" by editing JSON) has no code path that
// accepts it in the first place.
export const PROJECT_STATUSES = ["pending_guide", "active", "submitted", "completed", "rejected"];
export const MILESTONE_STATUSES = ["pending", "submitted", "approved", "rejected"];
export const PROJECT_GRADES = ["A+", "A", "B+", "B", "C+", "C", "D", "F"];

export const MIN_TEAM_SIZE = 2; // including the leader
export const MAX_TEAM_SIZE = 5; // including the leader

// A project is "in progress" while any of these states hold. A student may
// only lead/belong to one in-progress project at a time - "completed" is the
// only true terminal state; "rejected" is still owned by the team (they can
// propose a new guide and continue), so it also counts as in-progress here.
const NON_TERMINAL_STATUSES = ["pending_guide", "active", "submitted", "rejected"];

export function ensureProjectCollections(db) {
  db.projects ||= [];
}

// ---- Shape helpers ------------------------------------------------------

function publicFile(file) {
  // storedName is an internal blob key and must never reach the client.
  if (!file) return null;
  return { name: file.name, type: file.type, size: file.size, uploadedBy: file.uploadedBy, uploadedAt: file.uploadedAt };
}

function publicMilestone(milestone) {
  return { ...milestone, submission: publicFile(milestone.submission) };
}

export function publicProject(project) {
  return {
    ...project,
    milestones: (project.milestones || []).map(publicMilestone),
    finalSubmission: publicFile(project.finalSubmission)
  };
}

// ---- Membership / access -------------------------------------------------

export function isProjectMember(project, userId) {
  return project.leaderId === userId || (project.memberIds || []).includes(userId);
}

export function canViewProject(project, user) {
  if (user.role === "admin") return true;
  if (user.role === "teacher") return project.guideId === user.id;
  if (user.role === "student") return isProjectMember(project, user.id);
  return false;
}

export function isProjectGuide(project, user) {
  return user.role === "teacher" && project.guideId === user.id;
}

// A student "has" an in-progress project if they lead one or are a member of
// one. Used both to block a second project and to block joining a second
// team as a member.
export function findInProgressProjectForStudent(db, studentId) {
  return (db.projects || []).find(
    (project) => NON_TERMINAL_STATUSES.includes(project.status) && isProjectMember(project, studentId)
  );
}

// ---- Team validation (server-side; never trust client-picked members) ---

// Throws with a user-facing message on any violation. Returns the de-duped,
// validated list of *non-leader* member ids.
export function validateTeamMembers(db, { leaderId, leaderClassName, type, memberIds }) {
  if (type === "individual") {
    if (Array.isArray(memberIds) && memberIds.length) throw new Error("Individual projects cannot have team members.");
    return [];
  }

  if (!Array.isArray(memberIds)) throw new Error("Team projects require a list of member IDs.");
  const unique = [...new Set(memberIds.map((id) => String(id)))].filter((id) => id !== leaderId);
  const totalSize = unique.length + 1; // + leader
  if (totalSize < MIN_TEAM_SIZE) throw new Error(`A team project needs at least ${MIN_TEAM_SIZE} members (including the leader).`);
  if (totalSize > MAX_TEAM_SIZE) throw new Error(`A team project cannot have more than ${MAX_TEAM_SIZE} members (including the leader).`);

  const students = db.students || [];
  for (const memberId of unique) {
    const student = students.find((item) => item.id === memberId);
    if (!student) throw new Error(`Team member ${memberId} is not a valid student.`);
    if (student.className !== leaderClassName) throw new Error(`Team member ${student.name} is not in the same class as the project leader.`);
    if (findInProgressProjectForStudent(db, memberId)) throw new Error(`Team member ${student.name} is already part of another in-progress project.`);
  }
  return unique;
}

export function validateGuide(db, guideId) {
  const guide = (db.teachers || []).find((item) => item.id === guideId);
  if (!guide) throw new Error("Selected guide is not a valid faculty member.");
  return guide;
}

// ---- Blob cleanup ---------------------------------------------------------

// A dedicated env override (not the shared UPLOAD_DIR other routers read)
// so this doesn't collide with faculty-notes/submissions on the filesystem
// if an operator ever sets one of those.
export const projectUploadRoot = path.resolve(process.env.PROJECT_UPLOAD_DIR || path.join(process.cwd(), "storage", "project-documents"));

export async function deleteProjectBlobs(storedNames) {
  const unique = [...new Set((storedNames || []).filter(Boolean))];
  await Promise.all(unique.map((storedName) => deleteFile({ storedName, localDir: projectUploadRoot }).catch(() => {})));
}

// ---- Status-transition guards ---------------------------------------------

export class ProjectStateError extends Error {}

export function assertProjectStatus(project, allowed, message) {
  if (!allowed.includes(project.status)) {
    throw new ProjectStateError(message || `This action is not allowed while the project status is "${project.status}".`);
  }
}

export function assertMilestoneStatus(milestone, allowed, message) {
  if (!allowed.includes(milestone.status)) {
    throw new ProjectStateError(message || `This action is not allowed while the milestone status is "${milestone.status}".`);
  }
}

// All milestones (if any) must be approved before a final submission/review
// can proceed - a team with zero milestones can still submit directly.
export function allMilestonesApproved(project) {
  return (project.milestones || []).every((milestone) => milestone.status === "approved");
}
