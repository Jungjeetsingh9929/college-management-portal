# Phase 1 — Student Profile Enhancement

Extends the existing student profile only. No dependency on academic results,
feedback, projects, exams, or payments; nothing from those areas is imported.
`server/db/database.json` is untouched, and records without the new fields
render safely (the client falls back to empty values).

## API

`GET /api/students/me/profile` (new) and `PUT /api/students/me/profile` (extended).

- Student-only. Identity comes from `req.user.id` only — never from the body,
  query string, or a URL parameter. Missing/invalid token → `401`;
  authenticated teacher/admin → `403`.
- Responses are `{ student }` built with `publicStudent()` (no `password`,
  `passwordHistory`, `passwordVersion`).
- Allowed PUT fields (anything else → `400`, including `name`, `rollNumber`,
  `className`, `department`, `email`, `password`, `approvalStatus`, `photoId`,
  `active`, `id`):

| Field | Rule |
|---|---|
| `phone`, `guardian` | string, trimmed, ≤ 120 chars (unchanged limit) |
| `bio` | string, trimmed, ≤ 300 chars |
| `skills` | array, ≤ 10 items, each trimmed, 1–30 chars; case-insensitive duplicates dropped |
| `linkedin`, `github` | `""` (clear) or a valid `https:` URL on `linkedin.com` / `github.com` (or a subdomain); no credentials or port; ≤ 200 chars; stored as the normalised href |
| `emergencyContactName` | string, trimmed, ≤ 80 chars |
| `emergencyContactPhone` | string, trimmed, ≤ 20 chars, only digits, `+`, spaces, `-` (at least one digit) |

- Text fields also reject control characters (and newlines, except in `bio`).
- Validation failures return `{ message, field }` so the client can mark the field.
- Behaviour change: an empty body `{}` on PUT is now `400` (it used to be a silent no-op).
- Validation lives in `server/services/profileValidation.js` (pure, no imports).

## Client

- `StudentProfile.jsx` edited in place: new completeness bar, **About me** card
  (bio, skills chip input, LinkedIn/GitHub), **Emergency contact** card, and one
  **Save profile** flow that also covers phone/guardian (loading, success, error,
  disabled-button, and per-field states). Existing hero, photo panel, academic
  details, and status-request box are unchanged.
- `AuthContext.jsx`: added `updateUser(patch)`, which merges the saved student
  into `user` (keeping `role`), so the page and header don't show stale data.
- `utils/profileValidation.js`: client mirror of the server rules; a saved link
  is only rendered as an anchor (`target="_blank" rel="noopener noreferrer"`)
  if it passes the same URL check, otherwise it is not linked. All user text is
  rendered through React (no `dangerouslySetInnerHTML`).
- Completeness = approved photo, phone, guardian, bio, skills, emergency contact
  (name and phone), computed from the saved record.

## Tests

- `tests/api.test.js`: new Phase 1 block — valid update, partial update/clear,
  unknown and forbidden keys, invalid URL schemes/hosts, overlong bio, >10
  skills, teacher/admin `403`, missing/invalid auth `401`, no `password` in
  responses, identity not taken from query, photo state unchanged, and the
  student photo-admin route still `403`. The suite sets `PUBLIC_API_LIMIT` so
  the global per-IP limiter doesn't cause `429`s.
- `tests/profile-validation.test.js` (new, dependency-free) — added to `npm test`.

## Not changed (verified byte-identical to the previous zip)

`server/middleware/auth.js`, `server/routes/photos.js`,
`server/services/photoService.js`, `server/db/fileStore.js` (write lock),
`server/index.js`, `server/db/database.json`.

## Optional photo hardening — skipped

`sharp` could not be added and installed in this environment (npm registry
access is blocked, so no dependency install works at all), so the photo flow
was not modified: 2 MB limit and approval workflow are as before.
