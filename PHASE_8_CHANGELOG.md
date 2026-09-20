# Phase 8 — Hardening and polish

Delivered as four separate, independently reviewable commits (one per
sub-item in the brief), each on top of the unmodified Phase 1/2/4/7 tree,
so an issue in one does not hold up the others.

## Scope note

The merged tree at the start of this phase contains Phases 1 (profile), 2
(marks/CGPA), 4 (final-year projects) and 7 (payments) only. Three items in
the original brief have no corresponding feature in this codebase and were
left alone rather than invented:

- **Feedback-window changes** — no feedback-window concept exists; the only
  `feedback` field anywhere is the free-text remark on an assignment
  evaluation in `routes/faculty.js`.
- **Exam decisions** — `db.examinations` is announcement data only (subject,
  date, room); there is no eligibility/decision workflow.
- **Admit-card regeneration** — no admit-card feature exists in this tree.

Marks publication, lock, and unlock were **already audited** before this
phase (`marks.publish` / `marks.lock` / `marks.unlock` in `routes/marks.js`,
added during the marks phase).

## 8.1 — Authentication and input hardening

- `middleware/rateLimit.js` / new `middleware/rateLimitKeys.js`: login's
  per-account rate-limit bucket was keyed on the raw, uncanonicalised
  `req.body.email` — unbounded (near the full request body) and re-casable
  to mint a fresh bucket. `bodyFieldKey()` bounds, lower-cases, and
  hash-collapses long values.
- `services/validation.js`: split `validPassword()` (the policy for a
  password being **set**) from a new `validExistingPassword()` (bounds only,
  for a password being **checked** — login and `currentPassword`). Login and
  change-password previously applied the *set* policy to a *stored* hash,
  permanently locking out any account created before the policy existed.
  Login now also returns `passwordPolicyStale` so the client can prompt a
  change without blocking sign-in.
- `routes/auth.js`: `validateKeys()` added to `/refresh`, `/logout`,
  `/signup/request-otp`, `/signup/verify-otp`, `/request-password-otp`,
  `/reset-password-otp`. `request-otp` no longer persists the entire raw
  request body into `db.signupOtps`. `db.signupOtps` / `db.passwordOtps` are
  now pruned (expired entries removed, a hard cap enforced). `/refresh` has
  its own rate-limit bucket instead of sharing login's. A blank/invalid name
  surviving to `verify-otp` no longer 500s.
- No auth middleware was rewritten as part of the earlier student-profile
  phase; these are the first changes to `middleware/auth.js`'s surroundings,
  and `middleware/auth.js` itself is untouched.
- Tests: `tests/auth-hardening.test.js` (dependency-free, in `npm test`).

## 8.2 — Audit and notifications

- `routes/projects.js`: audit entries added for final review
  (`project.review`), guide response (`project.guide_response`), admin guide
  override (`project.guide_assigned`, warning severity), and milestone
  review (`project.milestone_review`).
- `routes/fees.js`: audit entries added for fee-structure edits
  (`fee.structure_updated`, warning severity — both the admin and HOD edit
  paths, which reprice every unpaid student in a department; only the
  smaller per-student manual adjustment was audited before) and fee
  reminders (`fee.reminder_sent`).
- `routes/shared.js`: `buildNotifications()` extended in place — no separate
  notification store — for project outcomes, milestone verdicts, guide
  requests awaiting a faculty response, outstanding/overdue fees, confirmed
  payments, and a failed-payment count for admins. Links point at the
  existing role dashboards (`/student`, `/faculty`, `/admin`); there is no
  client-side projects page in this tree to link to instead.

## 8.3 — Shared exports and dashboards

- New `services/csv.js`: extracts the identical row-join-and-escape loop
  that `attendanceService.js`, `reportService.js`, and `routes/marks.js` had
  each copied inline. Header lists and row content are untouched in every
  caller — only the underlying serialization is now written once. Covered
  by `tests/csv.test.js`, asserting byte-for-byte output against what each
  caller produced before.
- `components/AdminPaymentsPanel.jsx`: added a Recharts bar chart of
  paid/pending/failed counts, built from `history.totals` — a data source
  the panel already fetches, not a new one — with an explicit empty state
  when there is no payment activity yet.
- `services/marksPdf.js` + `GET /marks/sheet/:subjectId/export.pdf`: a mark
  sheet PDF export, built the same way `reportService.js`'s attendance PDF
  is (pdfkit, same error/close handling). Its own small module, independent
  of any admit-card generator — none exists in this codebase.

## 8.4 — Deferred baseline follow-ups

- **Top-bar avatar**: `services/photoService.js` gained `approvedPhotoId()`;
  `/auth/login` and `/auth/me` now include it on a student's own response.
  `AppLayout.jsx`'s new `TopbarAvatar` uses the existing `ProtectedImage`
  component with that id. Because the id travels on the already-loaded
  `AuthContext` user rather than being looked up per page, this does not add
  a fetch on every navigation — the concern noted in
  `PHOTO_APPROVAL_CHANGELOG.md`.
- **Library audience scoping**: new `services/audienceService.js` (pure,
  dependency-free — see `tests/audience.test.js`) provides
  `audienceVisibleTo()` / `applyAudience()`, mirroring the pattern
  `routes/events.js` already uses. `routes/library.js` wires it into
  `GET /`, `GET /:id/file`, `POST /`, and `PUT /:id`. The field is opt-in and
  defaults to `"all"`, so every item created before this change and every
  caller that never sends `audience` behaves exactly as before.
  `pages/DigitalLibrary.jsx` gained an audience selector (staff only) and an
  audience badge on scoped items, matching `EventsCalendar.jsx`'s pattern.
  Neither this nor the avatar change touches `routes/marks.js`,
  `routes/subjects.js`, or anything else in the academic/exam surface.
- **EXIF/GPS stripping**: still open. It requires adding the `sharp`
  dependency, and this build environment has no network egress to run
  `npm install` — that step has to happen wherever the dependency addition
  is actually approved and installable.

## Verification performed here

- `node --check` on every file under `server/` and `tests/` — 0 failures.
- Every relative import under `server/`, `tests/`, and `client/src/`
  resolves to a real file.
- All eight dependency-free test files pass:
  `client-origin`, `auth-hardening`, `csv`, `audience`, `upload-validation`,
  `profile-validation`, `marks-service`, `payments`.

**Not run here** (no network egress in this environment, consistent with
every earlier phase's changelog): `npm install`, `npm test` end-to-end
(the six tests that boot Express — `marks-api`, `payments-api`,
`project-workflow`, `api.test.js`, `quiz-session`, `regression-flow` — need
`npm install` first), and `vite build`. Please run
`npm install && npm test && npm run build` before deploying.
