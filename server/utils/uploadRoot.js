import path from "node:path";

// Every upload category (student photos, submissions, faculty notes,
// assignment attachments, ...) used to independently fall back to the same
// UPLOAD_DIR env var with no per-category subfolder appended when it was set.
// Under the default (unset) config each got its own storage/<category>
// folder, so this only broke once a deployer set UPLOAD_DIR (a very plausible
// "give it a persistent disk" step) — at that point every category silently
// landed in one flat directory, losing whatever operational separation
// (backups, quotas, retention per category) the variable name implied.
//
// This resolves a category's storage root the same way regardless of whether
// UPLOAD_DIR is set: <UPLOAD_DIR or storage/>/<category>.
export function resolveUploadRoot(category) {
  const base = process.env.UPLOAD_DIR || path.join(process.cwd(), "storage");
  return path.resolve(path.join(base, category));
}
