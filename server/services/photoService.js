import { deleteFile } from "../db/blobStore.js";
import { resolveUploadRoot } from "../utils/uploadRoot.js";

// Shared by routes/photos.js and the student-delete handler in
// routes/students.js so both agree on where photo blobs live.
export const photoUploadRoot = resolveUploadRoot("student-photos");
export const PHOTO_MAX_BYTES = Number(process.env.PHOTO_MAX_BYTES) || 2 * 1024 * 1024;

export function ensurePhotoCollections(db) {
  db.studentPhotos ||= [];
}

// Used to put the approved-photo id on a student's own /auth/login and /auth/me response.
export function approvedPhotoId(db, studentId) {
  ensurePhotoCollections(db);
  return db.studentPhotos.find((item) => item.studentId === studentId && item.status === "approved")?.id || null;
}

// Removes every photo record for a student from `db` and returns the blob keys to delete. Callers must writeDb(db) FIRST and then call deletePhotoBlobs(keys).
export function detachPhotosForStudent(db, studentId, { keepStatus = null } = {}) {
  ensurePhotoCollections(db);
  const removed = db.studentPhotos.filter((item) => item.studentId === studentId && item.status !== keepStatus);
  db.studentPhotos = db.studentPhotos.filter((item) => !removed.includes(item));
  return removed.map((item) => item.file?.storedName).filter(Boolean);
}

export async function deletePhotoBlobs(storedNames) {
  await Promise.all(storedNames.map((storedName) => deleteFile({ storedName, localDir: photoUploadRoot }).catch(() => {})));
}
