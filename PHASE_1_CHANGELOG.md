# Phase 1 — Student Role Audit & Fixes

## 1. Live Quiz Session Updates (fixed)
**File:** `client/src/pages/QuizSession.jsx`
- Previously fetched the session once on mount, so new questions pushed by
  faculty never appeared without a manual page refresh.
- Now polls `GET /shared/quiz-session/:id` every 5 seconds in the background
  while the session is live, merges in new questions automatically, and
  stops polling once `endsAt` has passed.
- Added a manual "Refresh" button for anyone who wants to force-check
  immediately, plus an inline "checking…" state.
- A transient poll failure (e.g. one dropped request) no longer wipes the
  screen — the error banner only shows on the very first failed load.

## 2. Assignment Submission Constraints (fixed)
**Files:** `server/routes/shared.js`, `client/src/pages/StudentAssignments.jsx`

Server-side (this is what actually matters for security — the client-side
state was previously just cosmetic and easy to bypass with a raw request):
- Added `isPastDeadline(dueDate)` — an assignment is past-deadline after
  23:59:59 on its due date (not from midnight of the due date itself).
- `POST /shared/student/assignments/:id/complete` now rejects with
  `403 The deadline for this assignment has passed…` once overdue, and with
  `409 You have already submitted this assignment…` once a file submission
  exists for it.
- `POST /shared/student/assignments/:id/submission` (file upload) now
  rejects duplicate file uploads (`409`) and uploads after the deadline
  (`403`).
- `DELETE /shared/student/assignments/:id/complete` (un-checking / withdrawing)
  now also refuses once a file has been submitted or the deadline has
  passed, so a student can't sidestep the above by withdrawing and
  resubmitting.

Client-side:
- `AssignmentRow` now proactively disables the checkbox, textarea, link
  field, file input, and both buttons once an assignment is overdue or
  already has a submitted file — with an explicit inline message — instead
  of only surfacing the error after a failed request.

## 3. Role Boundary Enforcement (audited, no change needed)
- Confirmed `ProtectedRoute` in `client/src/main.jsx` returns `<Navigate>`
  in place of the page element for a disallowed role, which means the
  guarded page component's function body (and therefore its data-fetching
  `useEffect`) never executes — so no protected data is fetched or briefly
  rendered before the redirect happens.
- Spot-checked all server route files (`admin.js`, `faculty.js`, `hod.js`,
  `students.js`, `fees.js`, `reports.js`, `schedules.js`, `subjects.js`,
  `teachers.js`, `shared.js`) — every mutating/sensitive route is gated by
  `requireAuth` plus the appropriate `requireAdmin` / `requireFaculty` /
  `requireHod` / inline role check. No gaps found.

## Tests added
**File:** `tests/api.test.js`
- Fixed a latent bug in the test harness's `request()` helper: it always
  forced `Content-Type: application/json`, which would have corrupted any
  `FormData` (file upload) request's multipart boundary. It now mirrors the
  real client's `apiFetch` behavior and omits the header for `FormData`
  bodies.
- Added coverage for: completing/editing an overdue assignment (`403`),
  uploading a file then attempting a duplicate upload (`409`), editing text
  after a file submission exists (`409`), and withdrawing after a file
  submission exists (`409`).

## How to verify locally
```
npm install
npm test        # runs tests/api.test.js and tests/quiz-session.test.js
npm run dev      # then manually walk through the student flows
```
(Automated tests could not be executed in this sandbox — no network access
for `npm install`. Please run `npm test` on your machine to confirm.)
