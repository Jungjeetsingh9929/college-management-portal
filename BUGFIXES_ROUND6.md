# Round 6 — Assignments blob-cleanup (fixes #1–#3 from Audit Round 6)

Scope: implements findings #1, #2, and #3 from `AUDIT_ROUND_6_REPORT.md` — the
three places the Assignments module deleted a database record without
deleting the file(s) it pointed at, leaking storage forever.

`npm install`/`npm test` could not be run in this sandbox (no network, no
`node_modules`). Every touched file was checked with `node --check`.

## New: `server/services/assignmentService.js`

Mirrors `projectService.js`'s `deleteProjectBlobs` pattern, since Assignments
has two upload categories (`assignment-attachments` for teacher reference
files, `submissions` for student-submitted files) instead of one:

- `assignmentAttachmentRoot` / `assignmentSubmissionRoot` — resolved via the
  same `resolveUploadRoot()` both `faculty.js` and `shared.js` already used
  independently, so this doesn't move where anything is stored.
- `collectAttachmentBlobs(assignment)` — pulls `storedName`s off an
  assignment's `attachments` array.
- `collectSubmissionBlobs(completions)` — pulls `storedName`s off one or more
  `assignmentCompletions.submissionFiles` arrays.
- `deleteAssignmentBlobs({ attachmentStoredNames, submissionStoredNames })` —
  de-duplicates and deletes both sets, best-effort (`.catch(() => {})` per
  file, same as `deleteProjectBlobs`), called **after** `writeDb(db)` so a
  crash mid-cleanup never leaves a record pointing at a deleted blob — only
  the reverse (a leaked blob, which is exactly the bug being fixed and is
  harmless to leave for a retry/GC pass).

## Fix #1 — `DELETE /faculty/assignments/:id/attachments/:attachmentId`

Now looks up the attachment being removed *before* filtering it out of
`assignment.attachments`, and deletes its blob after `writeDb`.

## Fix #2 — `DELETE /faculty/assignments/:id`

Now collects the assignment's own `attachments` **and** every matching
`assignmentCompletions` row's `submissionFiles` before either collection is
filtered, and deletes all of it after `writeDb` — the "60 file submissions
leaves 60 orphaned blobs" case from the audit.

## Fix #3 — `DELETE /students/:id`

Now collects the deleted student's `assignmentCompletions.submissionFiles`
before that filter runs, alongside the existing `detachPhotosForStudent` /
`deletePhotoBlobs` pattern already in this route, and cleans them up the
same way (after `writeDb`, alongside the photo-blob cleanup call).

## Not touched in this round

Findings #4 (class-change orphans submissions), #5 (filename sanitization),
#6 (GPS self-report, flagged as a discussion item, not a code fix), #7
(cross-student device-fingerprint check), and #8 (stale HOD status on the
client) are unchanged — next rounds, per the audit's suggested order.
