# Phase 2 — Real QR Attendance Check-In

## Context: two separate "session" features existed

The codebase has two unrelated systems that both involve a QR code and a
teacher-started "session":

1. **Attendance sessions** (`server/routes/attendance.js`, driving the
   **Attendance Command Center**) — rotating token, geofence, device-risk
   scoring, replay-proof nonce check-in. This is what this phase's request
   was about.
2. **Quiz sessions** (`server/routes/faculty.js` + `shared.js`, driving
   `QuizGenerator.jsx`, the sidebar's "QR Attendance" link) — a live
   question feed. Already renders its own QR via the external
   `api.qrserver.com` image API (flagged P2 in `ROLE_BASED_E2E_AUDIT.md`).
   **Not touched in this phase** — out of scope for this request.

`server/routes/attendance.js` already had a fully-built `/check-in` endpoint
(geofence + nonce replay guard + device-risk flag) with **zero client
consumer** — the Attendance Command Center only ever displayed the raw
token as text, and a comment in `QuizAnswer.jsx` referenced an
"AttendanceCheckin" component that was never actually built. This phase
fills that gap end-to-end.

## What changed

### `server/routes/attendance.js`
- Added `resolveClientOrigin()` / `qrCheckInUrl()`. The check-in URL is now
  a real `https://<host>/attend/<sessionId>?t=<qrToken>`, using (in order)
  `CLIENT_ORIGIN`/`FRONTEND_URL` (already required in production for CORS),
  then the request's `Referer` origin, then the request's own host.
- `POST /attendance/sessions`, `GET /attendance/sessions`, and
  `POST /attendance/sessions/:id/rotate` all now return this real URL as
  `session.qr` (previously a fake `attendance://...` URI with no page
  behind it).

### `client/src/pages/AttendCheckIn.jsx` (new)
- The `/attend/:sessionId` page: reads `?t=`, prompts for geolocation on a
  tap (not automatically — browsers want a clear user gesture for the
  permission prompt), POSTs to `/attendance/check-in`, shows a success/error
  state.
- **Bridging assumption** (please confirm this is what you wanted): on a
  successful check-in, it calls `GET /shared/quiz/active` and, if there's a
  live quiz question for the *same subject*, auto-forwards to
  `/student/quiz/:id` after ~1.2s. Otherwise it shows the check-in
  confirmation and returns to `/student` after ~2.2s. Since attendance
  sessions and quiz sessions are separate collections with no existing
  link between them, this was the most direct reading of "route to the
  question/quiz page on success" — happy to change the matching rule (e.g.
  same class instead of same subject) or drop the auto-forward entirely.
- Wrapped in `ProtectedRoute role="student"` in `main.jsx`, so an
  unauthenticated scan bounces through `/login?returnTo=/attend/<id>?t=<token>`
  and returns here automatically post-login — no new redirect logic needed,
  confirmed by the existing `Login.jsx` `returnTo` handling.

### `client/src/pages/AttendanceCommandCenter.jsx`
- Live sessions now render a real QR **image** (via the `qrcode` npm
  package, generated client-side as a data-URL PNG — no backend change
  beyond the real URL, no external image service, no CSP change needed).
- Added **Open link**, **Copy link**, and **Share to WhatsApp**
  (`https://wa.me/?text=...`) actions next to the QR.
- Extracted the session-card markup into a small `SessionCard` component
  (was one large inline expression) so the new QR/share block is readable.
- Removed the raw `Token · <qrToken>` text now that the real link/QR make
  it redundant.

### `server/routes/shared.js`
- `buildNotifications()` now derives a "Live attendance: `<Subject>`" bell
  notification for any student whose class matches an active, unexpired
  attendance session, linking straight to `/attend/<sessionId>?t=<qrToken>`.
  **This is intentionally not a stored per-student record.** Every other
  category in `buildNotifications` (assignments, exams, results, etc.) is
  computed live from its source collection on each poll — there's no
  separate "notification" table backing the bell icon to write into. Doing
  the same here means the notification appears the moment
  `db.attendanceSessions` gets the new session (i.e., the moment the
  teacher starts it) without a separate loop-and-write step, and never
  drifts out of sync with the session's real state.
- The notification id folds in `session.sequence`, so rotating the QR (which
  bumps `sequence`) surfaces as a fresh, unread notification instead of
  reusing one already marked read that points at an expired token.
- `GET /shared/quiz/active` now also returns each quiz's `subjectId` (small
  additive field) — used by `AttendCheckIn.jsx` to match a live quiz to the
  subject the student just checked into.

### Shared cleanup
- `client/src/utils/geolocation.js` (new): the GPS-lookup helper was
  duplicated in intent between `QuizAnswer.jsx` and the new check-in page;
  extracted once, `QuizAnswer.jsx` now imports it (identical behavior,
  parameterized denial message).
- `client/src/utils/device.js` (new): persisted per-browser fingerprint
  (`localStorage`, `crypto.randomUUID()`) for the check-in route's existing
  device-risk flag — previously that field was never sent by any client.

### Tests (`tests/api.test.js`)
Added coverage, inserted before the password-reset section so it runs
against a still-valid `student` token:
- `session.qr` matches the real `/attend/:sessionId?t=` URL shape, on
  create and on list.
- The enrolled student's class sees the bell notification with the correct
  href.
- A teacher cannot check in (403).
- A student can check in (`present`, correct `subjectId`).
- Reusing a check-in `nonce` is rejected (409) — this guard already
  existed server-side but had no test.
- Rotating the QR changes the token, and the old token is rejected (409)
  on the next check-in attempt.

All three test files pass (`npm test`, plus `tests/regression-flow.test.js`
run separately), and `npm run build` completes clean.

## Not changed / out of scope
- `QuizGenerator.jsx`'s separate QR flow still uses `api.qrserver.com`
  (the P2 item from the last audit). Only the Attendance Command Center's
  QR was in scope for this request. Worth doing as a follow-up — happy to
  do it now that `qrcode` is already a dependency.
- Item 2 of your last message ("Specifically check: [name the feature
  you're focused on]") came through with the placeholder unfilled, so
  nothing was checked for it. Let me know what should go there.
