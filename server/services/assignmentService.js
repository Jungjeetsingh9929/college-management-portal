import { deleteFile } from "../db/blobStore.js";
import { resolveUploadRoot } from "../utils/uploadRoot.js";

// Same two categories faculty.js and shared.js already resolve independently
// for saving/loading these files — resolveUploadRoot is deterministic per
// category name, so this points at the same folders. Centralized here so the
// cleanup helper below and both routers agree on where the blobs live.
export const assignmentAttachmentRoot = resolveUploadRoot("assignment-attachments");
export const assignmentSubmissionRoot = resolveUploadRoot("submissions");

export function ensureAssignmentCollections(db) {
  db.assignments ||= [];
  db.assignmentCompletions ||= [];
}

// Collect the storedNames of a teacher's reference attachments on an
// assignment. Call this BEFORE the attachment (or the whole assignment) is
// filtered/spliced out of the db.
export function collectAttachmentBlobs(assignment) {
  return (assignment?.attachments || []).map((item) => item.storedName).filter(Boolean);
}

// Collect the storedNames of every submitted file across one or more
// assignmentCompletions records. Accepts a single completion or an array.
// Call this BEFORE those completions are filtered/spliced out of the db.
export function collectSubmissionBlobs(completions) {
  const list = Array.isArray(completions) ? completions : [completions];
  return list.flatMap((completion) => (completion?.submissionFiles || []).map((file) => file.storedName)).filter(Boolean);
}

// Deletes attachment blobs and submission-file blobs together. Mirrors
// deleteProjectBlobs: de-duplicated, best-effort (a missing/already-gone file
// is not an error), safe to call with either list empty. Call this AFTER
// writeDb(db) succeeds, the same ordering every other module in this app
// uses (never delete the blob before the record pointing at it is durably
// gone, or a crash in between leaves a record pointing at nothing).
export async function deleteAssignmentBlobs({ attachmentStoredNames = [], submissionStoredNames = [] } = {}) {
  const attachments = [...new Set(attachmentStoredNames.filter(Boolean))];
  const submissions = [...new Set(submissionStoredNames.filter(Boolean))];
  await Promise.all([
    ...attachments.map((storedName) => deleteFile({ storedName, localDir: assignmentAttachmentRoot }).catch(() => {})),
    ...submissions.map((storedName) => deleteFile({ storedName, localDir: assignmentSubmissionRoot }).catch(() => {}))
  ]);
}
