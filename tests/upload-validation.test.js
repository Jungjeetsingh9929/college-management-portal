// Dependency-free (no express/db boot), like client-origin.test.js.
// Guards the upload allow-list: DOCX is opt-in per endpoint, and a renamed
// ZIP must not pass as a Word document.
import assert from "node:assert/strict";
import {
  DEFAULT_UPLOAD_TYPES,
  LIBRARY_UPLOAD_TYPES,
  PHOTO_UPLOAD_TYPES,
  createUploadFileFilter,
  extensionForMimetype,
  hasValidFileSignature,
  uploadFileFilter
} from "../server/services/uploadValidation.js";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const pdf = { mimetype: "application/pdf", buffer: Buffer.from("%PDF-1.7 body") };
const png = { mimetype: "image/png", buffer: Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(16)]) };
const realDocx = { mimetype: DOCX, buffer: Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from("..[Content_Types].xml..word/document.xml")]) };
const renamedZip = { mimetype: DOCX, buffer: Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from("..payload.class..")]) };

function filterResult(filter, file) {
  let accepted;
  filter({}, file, (_error, ok) => { accepted = ok; });
  return accepted;
}

// Original endpoints keep their original behaviour.
assert.equal(hasValidFileSignature(pdf), true);
assert.equal(hasValidFileSignature(png), true);
assert.equal(hasValidFileSignature(realDocx), false, "notes/submissions must not accept DOCX");
assert.equal(filterResult(uploadFileFilter, { mimetype: DOCX, originalname: "a.docx" }), false);
assert.deepEqual(DEFAULT_UPLOAD_TYPES, ["application/pdf", "image/png", "image/jpeg"]);

// Library accepts PDF + DOCX only.
assert.equal(hasValidFileSignature(realDocx, LIBRARY_UPLOAD_TYPES), true);
assert.equal(hasValidFileSignature(renamedZip, LIBRARY_UPLOAD_TYPES), false, "renamed ZIP must be rejected");
assert.equal(hasValidFileSignature(png, LIBRARY_UPLOAD_TYPES), false);
const libraryFilter = createUploadFileFilter(LIBRARY_UPLOAD_TYPES);
assert.equal(filterResult(libraryFilter, { mimetype: DOCX, originalname: "Notes.DOCX" }), true);
assert.equal(filterResult(libraryFilter, { mimetype: DOCX, originalname: "notes.pdf" }), false, "extension must match mimetype");
assert.equal(filterResult(libraryFilter, { mimetype: "image/png", originalname: "a.png" }), false);

// Profile photos: PNG/JPEG only - no PDF, DOCX or SVG.
const jpeg = { mimetype: "image/jpeg", buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0]) };
assert.equal(hasValidFileSignature(jpeg, PHOTO_UPLOAD_TYPES), true);
assert.equal(hasValidFileSignature(png, PHOTO_UPLOAD_TYPES), true);
assert.equal(hasValidFileSignature(pdf, PHOTO_UPLOAD_TYPES), false);
assert.equal(hasValidFileSignature(realDocx, PHOTO_UPLOAD_TYPES), false);
const photoFilter = createUploadFileFilter(PHOTO_UPLOAD_TYPES);
assert.equal(filterResult(photoFilter, { mimetype: "image/svg+xml", originalname: "a.svg" }), false);
assert.equal(filterResult(photoFilter, { mimetype: "image/jpeg", originalname: "me.JPG" }), true);
assert.equal(filterResult(photoFilter, { mimetype: "image/jpeg", originalname: "me.png" }), false, "extension must match mimetype");

assert.equal(extensionForMimetype(DOCX), "docx");
assert.equal(extensionForMimetype("image/jpeg"), "jpg");
assert.equal(extensionForMimetype("text/html"), null);

console.log("upload-validation tests passed");
