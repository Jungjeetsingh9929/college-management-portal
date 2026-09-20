# Phase 1, Module 3 — Student Photo Upload + Admin Approval

Students upload a profile photo; it only goes live once an admin approves it.
Same route → `readDb`/`writeDb` pattern as the previous modules; audit
logging and rate limiting come from the global middleware.

## Workflow

1. Student uploads a PNG/JPEG (max 2 MB, `PHOTO_MAX_BYTES`) on **My Profile** → status `pending`.
2. Admin reviews it under **Photo Approvals** → **Approve**, or **Reject** with a
   required reason (3–300 chars) shown to the student.
3. Approved photo appears as the profile-page avatar.
- Resubmitting replaces any earlier pending/rejected submission.
- If a student already has an approved photo, it **stays live** while a
  replacement is pending; approving the replacement swaps it and frees the old file.
- Students can withdraw a pending submission. Admins can remove any photo.
- Each student holds at most two records (one approved + one pending/rejected),
  so storage stays bounded. Rejected images are deleted immediately; only the
  verdict and reason are kept.

## What's new

- `server/routes/photos.js` — `db.studentPhotos`, mounted at `/api/photos`.
  - Student: `GET /me`, `POST /me` (multipart, field `file`), `DELETE /me/pending`.
  - Admin: `GET /?status=pending|approved|rejected|all` (oldest first, with
    counts), `POST /:id/approve`, `POST /:id/reject`, `DELETE /:id`.
  - `GET /:id/image` — admin: any photo; student: their own; teacher: only an
    **approved** photo of a student in a class they teach. Pending/rejected
    photos never leave the student/admin pair. Served `inline` with `nosniff`
    and a locked-down CSP.
  - Status changes are one-way (`pending` → approved/rejected); re-reviewing
    returns 409.
- `server/services/photoService.js` — shared blob location/limit and
  `detachPhotosForStudent` (records removed before blobs, so a failed DB write
  can't orphan a record).
- `server/services/uploadValidation.js` — `PHOTO_UPLOAD_TYPES` (PNG/JPEG only;
  no SVG, PDF or DOCX). Existing endpoints unchanged.
- `server/routes/students.js` — deleting a student now also deletes their
  photo records and files.
- `server/routes/shared.js` — bell notifications: admins see a pending-photo
  count linking to the queue; students see their latest verdict for 14 days.
- `client/src/components/ProtectedImage.jsx` — loads an authenticated image via
  `apiDownload` (token refresh included) into a blob URL; needed because a
  plain `<img src>` can't send the bearer token.
- `client/src/components/ProfilePhotoPanel.jsx` + `StudentProfile.jsx` — upload
  card with pending/rejected state; hero avatar shows the approved photo.
- `client/src/pages/PhotoApprovals.jsx` — admin queue (`/photo-approvals`,
  admin-only route + "Photo Approvals" nav entry).
- `styles.css` — `.photo-*` / `.avatar-photo` rules.
- `tests/upload-validation.test.js` — extended for photo types.

## Known limits / follow-ups

- **EXIF metadata (including GPS) is not stripped** — the project has no image
  library. Adding `sharp` would let us re-encode and resize on upload.
- The top-bar avatar still shows the initial letter; every page mounts its own
  layout, so showing the photo there would refetch on each navigation.
  Teachers can already fetch approved photos via the API for later modules
  (e.g. attendance lists).
- Photo content itself (is it a face?) is judged by the admin, not the server.

## Verification done in the build sandbox

No `node_modules` / network, so the dev server was not booted.
- `node --check` on every touched server file; whole client bundled with esbuild.
- `tests/upload-validation.test.js` passes.
- Route handlers run against stubbed express/multer/db/blob layers: upload
  validation (SVG/GIF/PDF/fake bytes/oversize/extra fields), replace-pending,
  reject/approve/replace flows, one-way status, permission matrix for every
  role on pending and approved images, withdraw, admin remove, student-delete
  cleanup, orphan records — all passed.
- **Please still run `npm install && npm test && npm run dev` and click through
  upload → approve/reject once.**
