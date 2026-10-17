import path from "node:path";

// Every upload category (student photos, submissions, faculty notes, assignment attachments.
export function resolveUploadRoot(category) {
  const base = process.env.UPLOAD_DIR || path.join(process.cwd(), "storage");
  return path.resolve(path.join(base, category));
}
