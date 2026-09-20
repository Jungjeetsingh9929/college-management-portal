import crypto from "node:crypto";
import multer from "multer";
import { Router } from "express";
import { deleteFile, loadFile, saveFile } from "../db/blobStore.js";
import { makeId, readDb, writeDb } from "../db/fileStore.js";
import { requireAdmin, requireAuth } from "../middleware/auth.js";
import { classesTaughtByTeacher } from "../services/accessService.js";
import { PHOTO_MAX_BYTES, deletePhotoBlobs, detachPhotosForStudent, ensurePhotoCollections, photoUploadRoot } from "../services/photoService.js";
import { PHOTO_UPLOAD_TYPES, createUploadFileFilter, extensionForMimetype, hasValidFileSignature } from "../services/uploadValidation.js";
import { requiredText, validateKeys } from "../services/validation.js";

export const photosRouter = Router();

export const PHOTO_STATUSES = ["pending", "approved", "rejected"];

const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: PHOTO_MAX_BYTES, files: 1 },
  fileFilter: createUploadFileFilter(PHOTO_UPLOAD_TYPES)
});

function parseUpload(req, res, next) {
  photoUpload.single("file")(req, res, (error) => {
    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ message: `Photo is too large (limit ${Math.round(PHOTO_MAX_BYTES / 1024)} KB).` });
    }
    if (error) return res.status(400).json({ message: "Could not read the uploaded photo." });
    next();
  });
}

function requireStudentRole(req, res, next) {
  if (req.user?.role !== "student") return res.status(403).json({ message: "Only students can upload a profile photo." });
  next();
}

// storedName is an internal blob key and is never sent to clients.
function publicPhoto(record) {
  return {
    id: record.id,
    studentId: record.studentId,
    status: record.status,
    submittedAt: record.submittedAt,
    reviewedAt: record.reviewedAt || null,
    reviewedBy: record.reviewedBy?.name || null,
    rejectionReason: record.rejectionReason || "",
    size: record.file?.size || 0,
    hasImage: Boolean(record.file?.storedName)
  };
}

// ---- Student: own photo ----------------------------------------------------

photosRouter.get("/me", requireAuth, requireStudentRole, async (req, res) => {
  const db = await readDb();
  ensurePhotoCollections(db);
  const mine = db.studentPhotos.filter((item) => item.studentId === req.user.id);
  const approved = mine.find((item) => item.status === "approved") || null;
  const pending = mine.find((item) => item.status === "pending") || null;
  // A rejection is only worth showing until the student has resubmitted.
  const rejected = pending ? null : mine.find((item) => item.status === "rejected") || null;
  res.json({
    approved: approved && publicPhoto(approved),
    pending: pending && publicPhoto(pending),
    rejected: rejected && publicPhoto(rejected),
    maxFileBytes: PHOTO_MAX_BYTES
  });
});

// Uploading replaces any earlier pending/rejected submission. The currently
// approved photo stays live until an admin approves the replacement.
photosRouter.post("/me", requireAuth, requireStudentRole, parseUpload, async (req, res) => {
  try {
    validateKeys(req.body || {}, []);
  } catch {
    return res.status(400).json({ message: "Request contains unsupported fields." });
  }
  if (!req.file) return res.status(400).json({ message: "Choose a PNG or JPEG photo." });
  if (!hasValidFileSignature(req.file, PHOTO_UPLOAD_TYPES)) {
    return res.status(400).json({ message: "The uploaded photo content does not match its declared type." });
  }

  const storedName = `${crypto.randomUUID()}.${extensionForMimetype(req.file.mimetype)}`;
  await saveFile({ storedName, buffer: req.file.buffer, localDir: photoUploadRoot });

  let staleBlobs;
  let record;
  try {
    const db = await readDb();
    ensurePhotoCollections(db);
    if (!(db.students || []).some((item) => item.id === req.user.id)) {
      await deleteFile({ storedName, localDir: photoUploadRoot }).catch(() => {});
      return res.status(404).json({ message: "Student not found." });
    }
    staleBlobs = detachPhotosForStudent(db, req.user.id, { keepStatus: "approved" });
    record = { id: makeId("photo"), studentId: req.user.id, status: "pending", file: { type: req.file.mimetype, size: req.file.size, storedName }, submittedAt: new Date().toISOString() };
    db.studentPhotos.push(record);
    await writeDb(db);
  } catch (error) {
    await deleteFile({ storedName, localDir: photoUploadRoot }).catch(() => {});
    throw error;
  }
  await deletePhotoBlobs(staleBlobs);
  res.status(201).json({ photo: publicPhoto(record), message: "Photo submitted for admin approval." });
});

// Withdraw a submission that hasn't been reviewed yet.
photosRouter.delete("/me/pending", requireAuth, requireStudentRole, async (req, res) => {
  const db = await readDb();
  ensurePhotoCollections(db);
  const record = db.studentPhotos.find((item) => item.studentId === req.user.id && item.status === "pending");
  if (!record) return res.status(404).json({ message: "No pending photo to withdraw." });
  db.studentPhotos = db.studentPhotos.filter((item) => item !== record);
  await writeDb(db);
  await deletePhotoBlobs([record.file?.storedName].filter(Boolean));
  res.json({ success: true, message: "Submission withdrawn." });
});

// ---- Admin: review queue ---------------------------------------------------

photosRouter.get("/", requireAuth, requireAdmin, async (req, res) => {
  const db = await readDb();
  ensurePhotoCollections(db);
  const status = req.query.status === undefined || req.query.status === "" ? "pending" : String(req.query.status);
  if (status !== "all" && !PHOTO_STATUSES.includes(status)) return res.status(400).json({ message: "Status filter is invalid." });

  const students = new Map((db.students || []).map((student) => [student.id, student]));
  // Records whose student no longer exists are ignored rather than crashing the queue.
  const live = db.studentPhotos.filter((item) => students.has(item.studentId));
  const items = live
    .filter((item) => status === "all" || item.status === status)
    .sort((a, b) => String(a.submittedAt).localeCompare(String(b.submittedAt)))
    .map((item) => {
      const student = students.get(item.studentId);
      return { ...publicPhoto(item), student: { id: student.id, name: student.name, rollNumber: student.rollNumber, className: student.className, department: student.department } };
    });
  res.json({
    items,
    stats: {
      pending: live.filter((item) => item.status === "pending").length,
      approved: live.filter((item) => item.status === "approved").length,
      rejected: live.filter((item) => item.status === "rejected").length
    }
  });
});

photosRouter.post("/:id/approve", requireAuth, requireAdmin, async (req, res) => {
  try {
    validateKeys(req.body || {}, []);
  } catch {
    return res.status(400).json({ message: "Request contains unsupported fields." });
  }
  const db = await readDb();
  ensurePhotoCollections(db);
  const record = db.studentPhotos.find((item) => item.id === req.params.id);
  if (!record) return res.status(404).json({ message: "Photo not found." });
  if (record.status !== "pending") return res.status(409).json({ message: "This photo has already been reviewed." });
  const student = (db.students || []).find((item) => item.id === record.studentId);
  if (!student) return res.status(404).json({ message: "Student not found." });

  // Only one approved photo per student: the previous one is replaced.
  const replaced = db.studentPhotos.filter((item) => item.studentId === record.studentId && item.status === "approved");
  db.studentPhotos = db.studentPhotos.filter((item) => !replaced.includes(item));
  record.status = "approved";
  record.reviewedAt = new Date().toISOString();
  record.reviewedBy = { id: req.user.id, name: req.user.name };
  record.rejectionReason = "";
  student.photoId = record.id;
  await writeDb(db);
  await deletePhotoBlobs(replaced.map((item) => item.file?.storedName).filter(Boolean));
  res.json({ photo: publicPhoto(record), message: "Photo approved." });
});

photosRouter.post("/:id/reject", requireAuth, requireAdmin, async (req, res) => {
  try {
    validateKeys(req.body || {}, ["reason"]);
  } catch {
    return res.status(400).json({ message: "Request contains unsupported fields." });
  }
  let reason;
  try {
    reason = requiredText(req.body.reason, "Reason", { min: 3, max: 300 });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
  const db = await readDb();
  ensurePhotoCollections(db);
  const record = db.studentPhotos.find((item) => item.id === req.params.id);
  if (!record) return res.status(404).json({ message: "Photo not found." });
  if (record.status !== "pending") return res.status(409).json({ message: "This photo has already been reviewed." });

  const storedName = record.file?.storedName;
  record.status = "rejected";
  record.reviewedAt = new Date().toISOString();
  record.reviewedBy = { id: req.user.id, name: req.user.name };
  record.rejectionReason = reason;
  // A rejected image has no further use, so it is not kept.
  if (record.file) record.file.storedName = null;
  await writeDb(db);
  await deletePhotoBlobs([storedName].filter(Boolean));
  res.json({ photo: publicPhoto(record), message: "Photo rejected." });
});

// Admin can remove any photo record (e.g. an approved photo that turns out to
// be inappropriate). If it was the student's live photo, that link is cleared.
photosRouter.delete("/:id", requireAuth, requireAdmin, async (req, res) => {
  const db = await readDb();
  ensurePhotoCollections(db);
  const record = db.studentPhotos.find((item) => item.id === req.params.id);
  if (!record) return res.status(404).json({ message: "Photo not found." });
  db.studentPhotos = db.studentPhotos.filter((item) => item !== record);
  const student = (db.students || []).find((item) => item.id === record.studentId);
  if (student && student.photoId === record.id) delete student.photoId;
  await writeDb(db);
  await deletePhotoBlobs([record.file?.storedName].filter(Boolean));
  res.json({ success: true, message: "Photo removed." });
});

// ---- Image bytes -----------------------------------------------------------
// Admin: any photo. Student: their own. Teacher: only an *approved* photo of a
// student in a class they teach. Pending/rejected photos never leave the
// student/admin pair.
photosRouter.get("/:id/image", requireAuth, async (req, res) => {
  const db = await readDb();
  ensurePhotoCollections(db);
  const record = db.studentPhotos.find((item) => item.id === req.params.id);
  if (!record || !record.file?.storedName) return res.status(404).json({ message: "Photo not found." });

  let allowed = req.user.role === "admin" || (req.user.role === "student" && record.studentId === req.user.id);
  if (!allowed && req.user.role === "teacher" && record.status === "approved") {
    const student = (db.students || []).find((item) => item.id === record.studentId);
    allowed = Boolean(student && classesTaughtByTeacher(db, req.user.code).includes(student.className));
  }
  if (!allowed) return res.status(403).json({ message: "You do not have access to this photo." });

  const buffer = await loadFile({ storedName: record.file.storedName, localDir: photoUploadRoot });
  if (!buffer) return res.status(404).json({ message: "Photo not found." });
  res.set("Content-Type", record.file.type);
  res.set("Content-Disposition", "inline");
  res.set("X-Content-Type-Options", "nosniff");
  res.set("Content-Security-Policy", "default-src 'none'");
  res.send(buffer);
});
