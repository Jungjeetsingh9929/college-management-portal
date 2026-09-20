# Phase 1, Module 2 — Digital Library

Uploaded documents (PDF / DOCX) **and** external links, browsable by every
signed-in user and managed by staff. Same route → `readDb`/`writeDb` pattern
as Events Calendar; reuses the global audit-logging and rate-limiting
middleware in `server/index.js`.

## What's new

- `server/routes/library.js` — `db.library` collection, mounted at `/api/library`.
  - `GET /` — any signed-in user. Filters: `?category=`, `?type=file|link`,
    `?q=` (title/subject/description), staff-only `?mine=true`. Returns
    `categories`, `maxFileBytes` and `stats`.
  - `POST /` — staff only. Multipart for files (`type=file`, field `file`),
    plain JSON for links (`type=link`, `url`).
  - `PUT /:id` — creator or admin. **Metadata only** (title, description,
    category, subject, and `url` for links). Type and the uploaded file are
    immutable; to replace a document, delete and re-add.
  - `DELETE /:id` — creator or admin; also removes the stored blob.
  - `GET /:id/file` — any signed-in user; served as an attachment.
  - Categories: Textbook, Notes, Question Paper, Syllabus, Reference,
    Research Paper, Other.
  - Links must be `http(s)` with no embedded credentials (blocks
    `javascript:` / `data:` URLs from ever being stored).
  - Size limit `LIBRARY_MAX_BYTES` (default 10 MB). Files live in
    `storage/library` (dev) or the Postgres blob table (prod) via `blobStore.js`.
  - The internal `storedName` is never returned to clients.
- `server/services/uploadValidation.js` — **DOCX support**, but as an
  *opt-in per endpoint*: notes and submissions still accept only
  PDF/PNG/JPEG. New exports: `createUploadFileFilter(types)`,
  `LIBRARY_UPLOAD_TYPES`, `DEFAULT_UPLOAD_TYPES`; `hasValidFileSignature`
  takes an optional `types` argument. Existing callers are unchanged.
  DOCX check requires the ZIP header **and** the `[Content_Types].xml` and
  `word/` package parts, so a renamed `.zip` is rejected.
- `client/src/pages/DigitalLibrary.jsx` — stats, staff add/edit form
  (file-or-link toggle), search + category/type filters, download / open-link
  buttons (downloads go through `downloadToFile`, so they get the token
  refresh retry).
- `/library` route + "Digital Library" nav entry for all three roles.
- `styles.css` — `.library-*` classes and category/type badge colours.
- `tests/upload-validation.test.js` — dependency-free; added to `npm test`.

## Decisions worth a look

- **Per-class audience, added in Phase 8.4** (superseding the note below):
  opt-in `audience` field, defaulting to `"all"` for full backward
  compatibility with items and callers from before this field existed. A
  teacher may scope an item to a class they teach; an admin to any class.
  Enforced on `GET /`, `GET /:id/file`, `POST /`, and `PUT /:id` via
  `server/services/audienceService.js` (shared, dependency-free logic —
  see `tests/audience.test.js`).
- **Teachers can add to the library**, and manage only their own items;
  admins manage everything. Students are read-only.
- Deleting a record removes the blob after the DB write, so a failed blob
  cleanup can only leave an unreachable file, never a dangling record.

## Verification done in the build sandbox

No `node_modules` / network, so the dev server was not booted.
- `node --check` on every touched server file.
- Whole client bundled with esbuild from `main.jsx` (all imports resolve).
- `tests/upload-validation.test.js` passes.
- Route handlers exercised against stubbed express/multer/db/blob layers
  (permissions, validation, link schemes, file signatures, oversize, download,
  edit/delete + blob cleanup): all passed. **Please still run
  `npm install && npm test && npm run dev` locally and click through it once.**
