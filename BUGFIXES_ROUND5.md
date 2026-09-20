# Round 5 — Concurrency & Storage Layer

Scope: `databaseWriteLock`, the `writeDb` read-modify-write cycle, Postgres
vs. file-store divergence, and what breaks with 2+ server instances.

Read `AUDIT_FINDINGS.md`, `PHASE_1_CHANGELOG.md`, `PHASE_2_CHANGELOG.md`,
`ROLE_BASED_E2E_AUDIT.md`, and `PRODUCTION_CHECKLIST.md` first — those are
this project's prior rounds (there is no `BUGFIXES_ROUND1-4.md`; the naming
differs but they cover the same ground). `AUDIT_FINDINGS.md` already
confirmed `databaseWriteLock` genuinely serializes every mutating request's
handler execution process-wide, and flagged the multi-instance write-lock
scope as a known architectural limitation. This round starts from there and
looks specifically for routes that touch the database outside that lock —
per your note, the one you already fixed has siblings.

`npm install`/`npm test` could not be run in this sandbox (no network, no
`node_modules`). Every touched file was checked with `node --check`, and the
`tests/api.test.js` assertions that exercise the routes touched here
(`/admin/fees`, `/admin/fees/structures/:id`) were read against the new code
by hand to confirm the response shape is unchanged.

## How the lock actually works (for context on the fixes below)

`databaseWriteLock` (`server/db/fileStore.js`) is mounted globally in
`server/index.js`, before every router. For `POST`/`PUT`/`PATCH`/`DELETE`
requests it chains a per-process promise (`requestLock`) so that only one
mutating request's handler runs at a time, from `next()` until its response
finishes. That's what makes a route's own `readDb()` → mutate → `writeDb()`
cycle atomic relative to every *other* locked route.

Critically, `writeDb()`'s own `writeQueue` only serializes the physical
write call (so two overlapping writers can't torn-write the file/row) — it
does **not** serialize the read that came before it. A caller that does
`readDb()` → mutate → `writeDb()` from somewhere `databaseWriteLock` never
gated (a `GET` route, a background hook) can read state, do its work while a
locked request's write commits in between, and then overwrite that write
with its own now-stale copy of the whole document. Since every write
replaces the **entire** JSON document/row, that's not a partial corruption —
it's a silent full rollback of whatever the locked request just saved.

## Fixed

### 1. `server/routes/fees.js` — `GET /admin/fees` wrote to the database outside the lock

**What was wrong:** `GET /admin/fees` calls `ensureCollections(db)` to
lazily backfill any `feeStructures`/`studentFees` records missing for
departments/students that existed before those collections did, then
persisted the result with `writeDb(db)` — all inside a `GET` handler.
`databaseWriteLock` only gates `POST`/`PUT`/`PATCH`/`DELETE`, so this read
→ mutate → write cycle ran completely unserialized against every other
route in the app, including every other route that writes to the same
single JSON document.

**How it's triggered:** Any two admins (or one admin's browser polling the
fees dashboard) load `GET /admin/fees` around the same time another admin
saves something else — e.g. `PUT /admin/departments/:id`, editing a
student, approving an access request. No special timing or attacker
behavior is needed; it's a plain concurrent-request race that gets more
likely as usage grows.

**What breaks:** The `GET` request's `readDb()` can capture the document
*before* the concurrent locked write lands. The `GET` request then finishes
its own `writeDb()` *after* that locked write commits, replacing the whole
document with its own older copy — silently discarding the other admin's
save. Nothing errors; the other admin sees their change "stick" for a
moment and then vanish on the next reload, with no indication why.

**Fix:** Added `withWriteLock()` to `server/db/fileStore.js` — a small
helper that queues a callback onto the exact same `requestLock` chain
`databaseWriteLock` uses, so anything wrapped in it can't interleave with a
locked mutating request (or with another call to `withWriteLock` itself).
`GET /admin/fees`'s seed-and-persist cycle is now wrapped in it. The route's
response shape, status codes, and the rest of its logic are unchanged.

### 2. `server/index.js` — the audit-log write for failed `GET`/`HEAD` requests also wrote outside the lock

**What was wrong:** The request-logging middleware calls `recordAudit()`
(which does its own `readDb()` → append → `writeDb()`) whenever a mutating
request completes, or whenever *any* request — including a `GET` — finishes
with a 4xx/5xx status. For mutating requests this was already handled
correctly: the audit write is pushed onto `req.onWriteLockRelease` and runs
*before* that request's own lock slot is released (this is the mechanism
the code comments already describe and `AUDIT_FINDINGS.md` reviewed).
But for a `GET`/`HEAD` request that errored (e.g. a 401 from a bad token, a
404), `req.onWriteLockRelease` is never set — `databaseWriteLock` skips
those methods entirely — so the code fell through to calling
`recordAudit()` directly, with no lock at all. Same underlying pattern as
issue #1, just triggered by error responses instead of a specific route.

**How it's triggered:** Any request that 4xx/5xx's on a `GET` or `HEAD` —
an expired access token hitting a protected `GET` endpoint, a mistyped
`GET` URL, a student probing an admin-only `GET` route — while a mutating
request is concurrently in flight elsewhere in the app. Expired/invalid
tokens on `GET` requests happen constantly in normal usage (a tab left open
past token expiry, for instance), so this window opens far more often than
issue #1's.

**What breaks:** Same failure mode as #1 — the unlocked audit write's stale
`readDb()`/`writeDb()` pair can silently roll back a concurrent locked
request's save. It's not just audit-log entries at risk of being lost;
because `writeDb()` replaces the whole document, *any* data the concurrent
locked request just wrote (attendance, marks, a new notice, anything) can
be the casualty, not only the audit log itself.

**Fix:** The `else` branch that used to call `void runAudit()` directly now
calls `void withWriteLock(runAudit).catch(() => {})`, queuing onto the same
lock as issue #1's fix and as every locked route. Audit-log behavior,
response codes, and timing as observed by the client are unchanged — this
only affects when the *write* to disk/Postgres happens relative to other
writes.

## Checked — already correct, left alone

- Every other `writeDb()` call site in `server/routes/*.js` was traced back
  to confirm it sits inside a `POST`/`PUT`/`PATCH`/`DELETE` handler (i.e.
  already covered by `databaseWriteLock`). Full list checked: `admin.js`,
  `attendance.js`, `auth.js`, `complaints.js`, `faculty.js`, `fees.js`
  (all sites except the one fixed above), `hod.js`, `schedules.js`,
  `shared.js`, `students.js`, `subjects.js`, `teachers.js`. No other
  route-level victims of this pattern were found.
- `server/services/*.js` — only `auditService.js` touches the database;
  every other call to `recordAudit()` happens synchronously inside an
  already-locked mutating-route handler (e.g. the login/failed-login audit
  calls in `auth.js`'s `POST /login`), so those are fine as-is. The one
  path that wasn't locked is issue #2 above.
- `server/db/blobStore.js` (uploaded file bytes) — each file is keyed by a
  unique randomly-generated `storedName`; concurrent uploads never
  contend for the same key, so there's no read-modify-write race here to
  begin with.
- `server/middleware/rateLimit.js`'s Postgres path — uses a single atomic
  `INSERT … ON CONFLICT … DO UPDATE` per request with the read-then-decide
  logic expressed in SQL `CASE` clauses, not a JS read-modify-write. This
  is correct even across multiple instances, unlike the JSON-blob path
  below.
- No `setInterval`/`setTimeout`/cron-style background job in `server/`
  touches the database — the only write paths are request-triggered.
- `atomicWrite()`'s file-store path (temp file + `rename`) is atomic at the
  OS level for the write itself, and is dev/test-only — `NODE_ENV=production`
  requires `DATABASE_URL` (`fileStore.js:11`), so this path is never used
  under concurrent production traffic.

## Needs your decision — architectural, not a code-level fix

**Everything above only serializes writes within one Node process.**
`requestLock` and `writeQueue` are both module-level variables — every
server instance gets its own copy. If this is ever deployed as 2+ Render
instances behind a load balancer (the `render.yaml` in this repo currently
provisions a single instance, so today this is dormant), two requests
routed to *different* instances can both `readDb()` the same Postgres row,
both mutate their own in-memory copy, and both `writeDb()` — the lock on
each instance does nothing to stop the second instance's write from
clobbering the first's, because each instance only knows about its own
local lock. This was already called out as a known limitation in
`AUDIT_FINDINGS.md`'s "Known, not fixed" section; it's still true and still
out of scope for a code-level patch here, but worth restating plainly since
this round's fixes only close the single-instance version of the same bug.

Closing it for real needs one of:
- Move off the single-JSON-document model to real per-collection Postgres
  tables with row-level writes, so unrelated writes (e.g. one admin's
  department edit and another's fee update) don't contend for the same row
  at all. This is the "correct" fix but is a genuine data-model migration,
  not something to guess at without knowing your target schema.
- Or, if the single-document model needs to stay: wrap `atomicWrite`'s
  Postgres path in `SELECT … FOR UPDATE` (or an optimistic version-column
  check-and-retry) so the read-modify-write cycle is atomic at the database
  level instead of only in each process's memory. This makes 2+ instances
  safe without a data-model change, at the cost of every mutating request
  taking a real row lock — a bigger behavioral change than this round's
  brief, so flagging it rather than making it unasked.

Let me know which direction you want (or neither, if a single instance is
the permanent plan) and I'll implement it as its own round.

## Files touched

- `server/db/fileStore.js` — added `withWriteLock()`.
- `server/routes/fees.js` — `GET /admin/fees` now uses `withWriteLock()`.
- `server/index.js` — the unlocked audit-write branch now uses
  `withWriteLock()`.

All three pass `node --check`. No route paths, response shapes, or status
codes changed.

---

# Round 5b — attendance QR check-in URL no longer depends on `CLIENT_ORIGIN`

## The problem

`resolveClientOrigin()` in `server/routes/attendance.js` built the scannable
check-in URL from `CLIENT_ORIGIN`/`FRONTEND_URL`, falling back to the
request's `Referer`/host. Every one of those inputs can be wrong in a way the
application could not detect:

- The QR image renders fine.
- It scans fine.
- The failure happens on a student's phone, at a URL no one on the teacher's
  side ever sees.

It's the worst shape a config bug can have — no error, no log line, and the
only people who observe it are the ones who can't report it usefully.

## Fix 1 — remove the dependency (primary)

The teacher's browser already knows a correct, reachable origin: its own.
`QuizGenerator.jsx` was already doing the right thing here
(`window.location.origin`); attendance was the outlier.

- `server/routes/attendance.js` now returns **`qrPath`** — an origin-less
  `/attend/:sessionId?t=<token>` — on `POST /attendance/sessions`,
  `GET /attendance/sessions`, and `POST /attendance/sessions/:id/rotate`.
- `client/src/pages/AttendanceCommandCenter.jsx` resolves it against
  `window.location.origin` (`sessionCheckInUrl()`) before encoding the QR
  image and before building the Open / Copy / WhatsApp links.

The scanned URL is now correct by construction. No env var can break it.

`qr` (absolute) is still returned, unchanged in shape, for non-browser API
clients and any future server-sent share text; `sessionCheckInUrl()` falls
back to it, so an older client against a newer server still works, and vice
versa. Two new diagnostic fields, `qrOrigin` and `qrOriginSource`, say which
input produced the absolute URL (`CLIENT_ORIGIN`, `FRONTEND_URL`,
`request-referer`, or `request-host`).

## Fix 2 — fail fast on a bad origin (defense in depth)

`CLIENT_ORIGIN` still matters for things with no browser to ask: password
reset and fee reminder email links. New `server/config/clientOrigin.js` is
now the single parser for it, shared with the CORS allowlist in
`server/index.js` (which previously duplicated the parsing).

At startup, in production only, the server **refuses to boot** when the value
is missing, not an absolute URL, not http/https, carries a path/query/
fragment, or resolves to loopback. Plain `http` on a non-loopback host logs a
warning. Outside production nothing is fatal — local development is
untouched. A single malformed entry in a comma-separated list is dropped from
the allowlist rather than taking down CORS for the valid entries.

## Files touched

- `server/config/clientOrigin.js` — **new.** Parsing, validation, resolution.
- `server/routes/attendance.js` — `qrCheckInPath()` / `withQr()`; imports the
  shared resolver instead of parsing env inline.
- `server/index.js` — startup validation; CORS allowlist from the shared
  parser.
- `client/src/pages/AttendanceCommandCenter.jsx` — `sessionCheckInUrl()`.
- `tests/client-origin.test.js` — **new**, dependency-free.
- `tests/api.test.js` — extended the existing QR assertions to cover
  `qrPath`.
- `package.json`, `.env.example`, `PRODUCTION_CHECKLIST.md` — wiring and docs.

No route paths, status codes, or existing response fields changed.

---

# Round 5c — attendance reminder emails

## What this adds

Previously the only attendance reminder was the in-app bell notification
(`buildNotifications()` in `server/routes/shared.js`), which reaches a
student only if they already have the portal open — no use for the students
most likely to miss a session. This adds the push equivalent, mirroring the
fee reminder flow in `server/routes/fees.js`.

- **`sendAttendanceReminderEmail()`** in `server/services/emailService.js`,
  alongside `sendFeeReminderEmail()`. Same graceful degradation: with SMTP
  unset it logs in development, errors in production, and returns `false`
  rather than throwing.
- **`POST /attendance/sessions/:id/remind`** — staff only, and only the
  session's creator or an admin. Emails the check-in link to every student in
  the subject's class who has **not** already been marked for that session; a
  "you haven't checked in" email to someone who has is worse than no email.
  Returns a record with `recipients`, `delivered`, `skipped`, and a
  `delivery` status of `email-sent` / `email-partial` / `recorded-no-email`.
- **`GET /attendance/sessions/:id/reminders`** — the send history for a
  session.
- **Client**: an "Email reminder" button on live session cards in
  `AttendanceCommandCenter.jsx`, which displays the server's own result
  message rather than guessing at the outcome.

## Guards

- **409 on a session that isn't open.** No point mailing a link to a closed
  check-in window.
- **Rate limited per teacher + session** (default 3 per 5 minutes, via
  `ATTENDANCE_REMIND_WINDOW_MS` / `ATTENDANCE_REMIND_LIMIT`). Rotating the QR
  mid-class is normal and must not become a way to mail the class every
  minute.
- **The link is built server-side from the validated `CLIENT_ORIGIN`** (Round
  5b), never from the request body. An email landing in a student's inbox
  carrying a caller-supplied URL would be a ready-made phishing vector for
  harvesting student logins — this is the one place in the QR flow where the
  browser's own origin is *not* the safe source.

## Files touched

- `server/services/emailService.js` — `sendAttendanceReminderEmail()`.
- `server/routes/attendance.js` — the two new endpoints.
- `client/src/pages/AttendanceCommandCenter.jsx`, `client/src/styles.css` —
  the button and its result line.
- `tests/api.test.js` — covers the skip logic, the history endpoint, and the
  403 for students.
- `.env.example` — the two new rate-limit knobs.

No existing route paths, status codes, or response fields changed.
