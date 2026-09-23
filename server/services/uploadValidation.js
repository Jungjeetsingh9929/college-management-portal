import path from "node:path";

// Single source of truth for the upload allow-list. Add a new accepted type
// here (extension + magic-byte signature together).
//
// Each endpoint opts in to the subset it accepts (see the `types` argument
// below). Notes and submissions keep the original PDF/PNG/JPEG set; DOCX is
// only accepted where a route explicitly asks for it (the Digital Library),
// so extending the list doesn't silently widen older upload endpoints.
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const ALLOWED_TYPES = {
  "application/pdf": { extensions: [".pdf"], extension: "pdf", signature: (buffer) => buffer.toString("ascii", 0, 5) === "%PDF-" },
  "image/png": { extensions: [".png"], extension: "png", signature: (buffer) => buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) },
  "image/jpeg": { extensions: [".jpg", ".jpeg"], extension: "jpg", signature: (buffer) => buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff },
  // A .docx is a ZIP container, so "PK\x03\x04" alone would also match any
  // .zip/.jar/.apk renamed to .docx. Also require the OOXML package parts
  // every real Word document has: its first ZIP entry names are stored
  // uncompressed in the local file headers.
  [DOCX_MIME]: {
    extensions: [".docx"],
    extension: "docx",
    signature: (buffer) =>
      buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04 &&
      buffer.includes("[Content_Types].xml") && buffer.includes("word/")
  }
};

export const DEFAULT_UPLOAD_TYPES = ["application/pdf", "image/png", "image/jpeg"];
export const LIBRARY_UPLOAD_TYPES = ["application/pdf", DOCX_MIME];
// Profile photos: raster images only (no SVG, which can carry script).
export const PHOTO_UPLOAD_TYPES = ["image/png", "image/jpeg"];
// Final-year project documents (milestone and final-report uploads): reports
// are typically PDF or Word, plus PNG/JPEG for scanned/photographed pages or
// diagrams. Its own list, opt-in like LIBRARY_UPLOAD_TYPES, so widening it
// later doesn't also widen notes/submissions/photos.
export const PROJECT_UPLOAD_TYPES = ["application/pdf", DOCX_MIME, "image/png", "image/jpeg"];

/**
 * Builds a multer `fileFilter` that accepts a file only if its declared
 * mimetype is in `types` AND its filename extension matches that mimetype.
 * This does not inspect file bytes (multer hasn't buffered them yet at this
 * point) — pair with `hasValidFileSignature` after upload.
 */
export function createUploadFileFilter(types = DEFAULT_UPLOAD_TYPES) {
  return function fileFilter(_req, file, callback) {
    const allowed = types.includes(file.mimetype) ? ALLOWED_TYPES[file.mimetype] : null;
    const extension = path.extname(file.originalname || "").toLowerCase();
    callback(null, Boolean(allowed && allowed.extensions.includes(extension)));
  };
}

// Default filter, kept under its original name for existing callers.
export const uploadFileFilter = createUploadFileFilter();

/**
 * Confirms the uploaded buffer's magic bytes actually match its declared
 * (and already extension-checked) mimetype, so a relabeled file can't slip
 * through on a spoofed Content-Type + matching extension alone.
 */
export function hasValidFileSignature(file, types = DEFAULT_UPLOAD_TYPES) {
  const allowed = types.includes(file?.mimetype) ? ALLOWED_TYPES[file.mimetype] : null;
  if (!allowed || !file.buffer || file.buffer.length < 8) return false;
  return allowed.signature(file.buffer);
}

export function extensionForMimetype(mimetype) {
  return ALLOWED_TYPES[mimetype]?.extension || null;
}

/**
 * Sanitizes an uploaded file's original name before it's stored as display
 * text. multer decodes multipart filenames as latin1, which garbles any
 * non-ASCII name (e.g. Hindi/Bengali characters) unless it's re-decoded as
 * utf8 here. Also strips control characters, quotes, backslashes and path
 * separators so the name is safe to show back and to use in
 * `res.attachment()`/Content-Disposition. The actual blob on disk is always
 * a random `storedName`, so this is about display/output hygiene, not
 * path-traversal (that's handled separately at the storage layer).
 */
export function cleanFileName(originalName, fallback = "file") {
  const decoded = Buffer.from(String(originalName || ""), "latin1").toString("utf8");
  // eslint-disable-next-line no-control-regex
  const base = path.basename(decoded).replace(/[\u0000-\u001f\u007f"\\/]/g, "").trim();
  return (base || fallback).slice(0, 120);
}
