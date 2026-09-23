import crypto from "node:crypto";
import multer from "multer";
import { Router } from "express";
import { deleteFile, loadFile, saveFile } from "../db/blobStore.js";
import { makeId, readDb, writeDb } from "../db/fileStore.js";
import { requireAuth, requireStaff } from "../middleware/auth.js";
import { LIBRARY_UPLOAD_TYPES, cleanFileName, createUploadFileFilter, extensionForMimetype, hasValidFileSignature } from "../services/uploadValidation.js";
import { classesTaughtByTeacher } from "../services/accessService.js";
import { applyAudience, audienceVisibleTo } from "../services/audienceService.js";
import { enumValue, requiredText, validateKeys } from "../services/validation.js";
import { resolveUploadRoot } from "../utils/uploadRoot.js";

export const libraryRouter = Router();

export const LIBRARY_CATEGORIES = ["Textbook", "Notes", "Question Paper", "Syllabus", "Reference", "Research Paper", "Other"];
export const LIBRARY_ITEM_TYPES = ["file", "link"];
// "No per-class audience" was a deliberate Phase-1 decision (see
// LIBRARY_CHANGELOG.md). This adds it as opt-in, defaulting to "all", so
// every item created before this field existed - and every caller that
// never sends it - keeps behaving exactly as before.
const LIBRARY_FIELDS = ["title", "description", "category", "subject", "type", "url", "audience"];
const MAX_URL_LENGTH = 2000;

const libraryUploadRoot = resolveUploadRoot("library");
const libraryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: Number(process.env.LIBRARY_MAX_BYTES) || 10 * 1024 * 1024, files: 1 },
  fileFilter: createUploadFileFilter(LIBRARY_UPLOAD_TYPES)
});

// multer only parses multipart bodies, so JSON requests (external links, and
// metadata edits) pass straight through this middleware untouched.
function parseUpload(req, res, next) {
  libraryUpload.single("file")(req, res, (error) => {
    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ message: "Library file is too large." });
    }
    if (error) return res.status(400).json({ message: "Could not read the uploaded file." });
    next();
  });
}

function ensureCollections(db) {
  db.library ||= [];
}

// Only http(s) links are allowed: a stored `javascript:` or `data:` URL would
// become a script-injection vector the moment the client renders it as an href.
function validLink(value) {
  if (typeof value !== "string") throw new Error("A link URL is required.");
  const text = value.trim();
  if (!text || text.length > MAX_URL_LENGTH) throw new Error(`Link URL must be between 1 and ${MAX_URL_LENGTH} characters.`);
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    throw new Error("Link URL is not a valid URL.");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Link URL must start with http:// or https://.");
  if (parsed.username || parsed.password) throw new Error("Link URL must not contain credentials.");
  return parsed.toString();
}

function publicItem(item) {
  const { file, ...rest } = item;
  // storedName is an internal blob key — never sent to clients.
  return { ...rest, file: file ? { name: file.name, type: file.type, size: file.size } : null };
}

function canManage(item, user) {
  return user.role === "admin" || item.createdBy?.id === user.id;
}

// Thin wrapper over the shared audienceVisibleTo, kept named for readability
// at call sites in this file.
function libraryVisibleTo(item, user, db) {
  return audienceVisibleTo(item.audience, user, db);
}

libraryRouter.get("/", requireAuth, async (req, res) => {
  const db = await readDb();
  ensureCollections(db);
  let items = db.library.filter((item) => libraryVisibleTo(item, req.user, db));
  if (req.query.category) items = items.filter((item) => item.category === req.query.category);
  if (req.query.type) items = items.filter((item) => item.type === req.query.type);
  if (req.query.mine === "true" && req.user.role !== "student") items = items.filter((item) => item.createdBy?.id === req.user.id);
  const search = String(req.query.q || "").trim().toLowerCase().slice(0, 100);
  if (search) {
    items = items.filter((item) => [item.title, item.description, item.subject].some((field) => String(field || "").toLowerCase().includes(search)));
  }
  items = [...items].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).map(publicItem);

  res.json({
    items,
    categories: LIBRARY_CATEGORIES,
    // Classes staff can restrict an item to. Admin sees every class in the
    // system; a teacher sees only the classes they teach (applyAudience
    // enforces the same limit server-side, so this is a UI convenience,
    // not the access boundary).
    classes: req.user.role === "admin"
      ? [...new Set((db.students || []).map((item) => item.className).filter(Boolean))].sort()
      : req.user.role === "teacher"
      ? classesTaughtByTeacher(db, req.user.code)
      : [],
    maxFileBytes: Number(process.env.LIBRARY_MAX_BYTES) || 10 * 1024 * 1024,
    // Reflects what this caller can see, not the whole campus library - a
    // teacher's class-restricted items shouldn't inflate a student's
    // "total" with entries that were just filtered out of `items`.
    stats: {
      total: items.length,
      files: items.filter((item) => item.type === "file").length,
      links: items.filter((item) => item.type === "link").length
    }
  });
});

libraryRouter.post("/", requireAuth, requireStaff, parseUpload, async (req, res) => {
  try {
    validateKeys(req.body || {}, LIBRARY_FIELDS);
  } catch {
    return res.status(400).json({ message: "Request contains unsupported fields." });
  }

  let title, description, category, subject, type;
  try {
    title = requiredText(req.body.title, "Title", { max: 160 });
    description = req.body.description === undefined ? "" : requiredText(req.body.description, "Description", { min: 0, max: 2000 });
    category = enumValue(req.body.category, "Category", LIBRARY_CATEGORIES);
    subject = req.body.subject === undefined ? "" : requiredText(req.body.subject, "Subject", { min: 0, max: 120 });
    type = enumValue(req.body.type, "Type", LIBRARY_ITEM_TYPES);
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }

  const item = {
    id: makeId("lib"),
    title,
    description,
    category,
    subject,
    type,
    audience: "all",
    createdBy: { id: req.user.id, name: req.user.name, role: req.user.role },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  let storedName = null;
  if (type === "link") {
    if (req.file) return res.status(400).json({ message: "A link entry cannot include a file." });
    try {
      item.url = validLink(req.body.url);
    } catch (error) {
      return res.status(400).json({ message: error.message });
    }
  } else {
    if (req.body.url) return res.status(400).json({ message: "A file entry cannot include a link URL." });
    if (!req.file) return res.status(400).json({ message: "Attach one PDF or DOCX file." });
    if (!hasValidFileSignature(req.file, LIBRARY_UPLOAD_TYPES)) {
      return res.status(400).json({ message: "The uploaded file content does not match its declared type." });
    }
    storedName = `${crypto.randomUUID()}.${extensionForMimetype(req.file.mimetype)}`;
    item.file = { name: cleanFileName(req.file.originalname, "library-file"), type: req.file.mimetype, size: req.file.size, storedName };
    await saveFile({ storedName, buffer: req.file.buffer, localDir: libraryUploadRoot });
  }

  try {
    const db = await readDb();
    ensureCollections(db);
    const audienceError = applyAudience(item, req.body.audience, db, req.user);
    if (audienceError) {
      if (storedName) await deleteFile({ storedName, localDir: libraryUploadRoot }).catch(() => {});
      return res.status(403).json({ message: audienceError });
    }
    db.library.push(item);
    await writeDb(db);
  } catch (error) {
    // Don't leave an orphaned blob behind if the record couldn't be saved.
    if (storedName) await deleteFile({ storedName, localDir: libraryUploadRoot }).catch(() => {});
    throw error;
  }
  res.status(201).json({ item: publicItem(item), message: "Library item added." });
});

// Metadata only. The file itself is immutable — to replace a document,
// delete the entry and add a new one — which keeps this endpoint JSON-only.
libraryRouter.put("/:id", requireAuth, requireStaff, async (req, res) => {
  try {
    validateKeys(req.body || {}, LIBRARY_FIELDS.filter((field) => field !== "type"));
  } catch {
    return res.status(400).json({ message: "Request contains unsupported fields." });
  }
  const db = await readDb();
  ensureCollections(db);
  const item = db.library.find((entry) => entry.id === req.params.id);
  if (!item) return res.status(404).json({ message: "Library item not found." });
  if (!canManage(item, req.user)) return res.status(403).json({ message: "You can only edit items you added." });

  try {
    if (req.body.title !== undefined) item.title = requiredText(req.body.title, "Title", { max: 160 });
    if (req.body.description !== undefined) item.description = requiredText(req.body.description, "Description", { min: 0, max: 2000 });
    if (req.body.category !== undefined) item.category = enumValue(req.body.category, "Category", LIBRARY_CATEGORIES);
    if (req.body.subject !== undefined) item.subject = requiredText(req.body.subject, "Subject", { min: 0, max: 120 });
    if (req.body.url !== undefined) {
      if (item.type !== "link") return res.status(400).json({ message: "Only link entries have a URL." });
      item.url = validLink(req.body.url);
    }
    if (req.body.audience !== undefined) {
      const audienceError = applyAudience(item, req.body.audience, db, req.user);
      if (audienceError) return res.status(403).json({ message: audienceError });
    }
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }

  item.updatedAt = new Date().toISOString();
  await writeDb(db);
  res.json({ item: publicItem(item), message: "Library item updated." });
});

libraryRouter.delete("/:id", requireAuth, requireStaff, async (req, res) => {
  const db = await readDb();
  ensureCollections(db);
  const item = db.library.find((entry) => entry.id === req.params.id);
  if (!item) return res.status(404).json({ message: "Library item not found." });
  if (!canManage(item, req.user)) return res.status(403).json({ message: "You can only delete items you added." });
  db.library = db.library.filter((entry) => entry.id !== item.id);
  await writeDb(db);
  // Record is gone first; a failed blob cleanup only leaves an unreachable file.
  if (item.file?.storedName) await deleteFile({ storedName: item.file.storedName, localDir: libraryUploadRoot }).catch(() => {});
  res.json({ success: true, message: "Library item deleted." });
});

// Download an uploaded library file. Any signed-in user may read a
// campus-wide item; a class-scoped item is limited the same way GET /
// filters the list — otherwise a student who can't see a restricted item
// in the list could still fetch its file directly by guessing/reusing the id.
libraryRouter.get("/:id/file", requireAuth, async (req, res) => {
  const db = await readDb();
  ensureCollections(db);
  const item = db.library.find((entry) => entry.id === req.params.id);
  if (!item || item.type !== "file" || !item.file?.storedName) return res.status(404).json({ message: "File not found." });
  if (!libraryVisibleTo(item, req.user, db)) return res.status(403).json({ message: "You do not have access to this file." });
  const buffer = await loadFile({ storedName: item.file.storedName, localDir: libraryUploadRoot });
  if (!buffer) return res.status(404).json({ message: "File not found." });
  res.set("Content-Type", item.file.type || "application/octet-stream");
  res.set("X-Content-Type-Options", "nosniff");
  res.attachment(item.file.name || "library-file");
  res.send(buffer);
});
