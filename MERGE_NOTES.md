# Merge notes — `fixed__14_` + `round5c`

The two archives were **divergent branches, not sequential versions**. Neither
was a superset of the other, and `round5c` was branched from a point *before*
several security fixes in `fixed__14_` — so a naive "newest file wins" merge
would have silently reverted them.

Base = `fixed__14_`. Ported in from `round5c`. Conflicts resolved per file below.

## Taken from `round5c` (new work not present in `fixed__14_`)

| Item | File |
|---|---|
| Boot-time `CLIENT_ORIGIN` validation | `server/config/clientOrigin.js` (new) |
| Origin-less `qrPath` + `withQr()` | `server/routes/attendance.js` |
| Attendance reminder email endpoint + reminder list | `server/routes/attendance.js` |
| `sendAttendanceReminderEmail()` | `server/services/emailService.js` |
| `withWriteLock()` | `server/db/fileStore.js` |
| Audit hook queued onto the write lock | `server/index.js` |
| Reminder UI, `sessionCheckInUrl()` | `client/src/pages/AttendanceCommandCenter.jsx` |
| `.session-reminder-note` | `client/src/styles.css` |
| Origin + reminder test coverage | `tests/client-origin.test.js`, `tests/api.test.js` |
| Env + checklist documentation | `.env.example`, `PRODUCTION_CHECKLIST.md` |

## Deliberately NOT taken from `round5c` (they were regressions against `fixed__14_`)

- **CORS wildcard.** `round5c` restored `|| isNonProduction` in the origin
  callback, which short-circuits every other check and allows *any* origin
  whenever `NODE_ENV` is development or test — making the allow-list dead code.
  `fixed__14_`'s strict form is kept.
- **Refresh-token replay detection.** `round5c` predates
  `revokeSessionsForUser()` and the reuse-detection branch in
  `consumeRefreshToken()`. Keeping it would mean a stolen refresh token chain
  survives a password change.
- **Rate-limiter `scope`.** `round5c` has no `scope` parameter, so every
  prefix-mounted limiter silently degrades to per-endpoint.
- **fileStore hardening.** `round5c` lacks the Postgres advisory lock, pool
  error handler, connection timeout, init-retry, idempotent seed insert and
  temp-file cleanup.
- **Attendance input hardening.** `round5c` lacks the prototype-pollution-safe
  key checks on `nonce`/`idempotencyKey`, session date/duration validation, and
  teacher scoping on the review queue and corrections.
- **Client `apiFetch`/`apiDownload`.** `round5c` lacks the 401-refresh-retry on
  downloads and the FormData replay guard.
- **fees.js.** `round5c` wraps the `GET /admin/fees` write in `withWriteLock`;
  `fixed__14_` removes the write from the GET entirely, which is strictly
  better. Its numeric validation on `amountDue`/`amountPaid` is also kept.

## Repairs made during the merge

- **`server/services/accountService.js` was missing entirely.**
  `routes/auth.js`, `routes/admin.js`, `routes/teachers.js` and
  `routes/students.js` in `fixed__14_` all `import` from it. As shipped, that
  archive could not start — `ERR_MODULE_NOT_FOUND` at boot. The module has been
  reconstructed to the exact API the four call sites expect
  (`emailInUse`, `normalizeEmail`, `rollNumberInUse`, plus `accountForEmail`
  and `emailPending`).
- **`withWriteLock()` now takes the Postgres advisory lock too.** As written in
  `round5c` it only chained the in-process `requestLock`, so on multiple
  instances it would serialize against local requests while still racing every
  other instance — the harder failure to notice. It also now has the same
  force-open timeout backstop as `databaseWriteLock`.

## Verification performed

- Every relative import in the tree resolves to a real file (0 unresolved).
- Every named import matches an actual export in the target module (0 missing).
- All server/test JS parses under `node --check`.
- `tests/client-origin.test.js` passes.
- The remaining suites need `npm install`, which was unavailable offline.
