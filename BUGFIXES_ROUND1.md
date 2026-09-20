# Bug & loophole fixes — round 1

Every change is in the source with a comment explaining *why*. Nothing was
refactored for style; each edit targets a specific defect.

## Security holes

**1. Refresh tokens survived password change / deactivation / deletion.**
`passwordVersion` is bumped on password change, which invalidates *access*
tokens on their next request — but the refresh tokens stayed live and would
mint brand new access tokens. So "change my password because I was hacked"
did not end the attacker's session. Added `revokeSessionsForUser()`
(`server/middleware/auth.js`) and wired it into password changes, admin
password resets, account deactivation, and student/teacher deletion.

**2. No refresh-token reuse detection.** Tokens rotate on use, but replaying an
already-consumed token just returned 401 while the stolen chain kept working.
A replay now revokes every session for that user.

**3. Prototype pollution / forged replay keys.** `nonce` (check-in) and
`idempotencyKey` (batch attendance) were client strings used directly as
object keys. `"toString"` made `if (db.map[key])` truthy for a key nobody
stored — faking an already-used nonce or replaying a batch that never ran.
`"__proto__"` mutated the prototype instead of storing an own property, so the
replay guard never saw it again. Keys are now charset-validated, `__proto__` /
`constructor` / `prototype` are rejected, and lookups use `hasOwnProperty`.

**4. Duplicate accounts across collections.** `accountService.js` had
`emailInUse` / `rollNumberInUse` helpers that **nothing called**. Student
creation, teacher creation, student self-registration, and admin approval each
checked only their own collection, case-sensitively — so the same email could
become a student *and* a teacher, making login, password reset and OTP
delivery ambiguous. Two students could share a roll number, silently
corrupting every roster and report. All paths now go through the helpers.

**5. CORS allow-list was dead code in dev/test.** The condition ended in
`|| isNonProduction`, short-circuiting everything before it — any origin was
accepted whenever `NODE_ENV` was `development` or `test`. Removed; the
localhost pattern beside it still covers dev.

**6. Rate limiters were per-endpoint, not per-prefix.** The bucket key included
`req.path`, so the "120 requests/minute across the API" limiter actually
allowed 120/min to *each* endpoint. Added an explicit `scope` option and
applied it to the global, auth, search and admin limiters.

**7. `/api/admin/fees*` bypassed the admin rate limiter** because `feesRouter`
is mounted on bare `/api` and ran first. The admin limiter is now mounted
ahead of both routers.

**8. Teachers could reach data outside their classes:** the full attendance
review queue, any other teacher's quiz by id, and correction requests for any
student in the college (which they could then approve). All scoped now.

**9. Deleting an HOD left `department.hodId` dangling.** `requireHod` resolves
HOD status by scanning departments for `hodId`, so a reused id would silently
inherit HOD privileges.

## Crashes (unhandled exceptions → HTTP 500)

**10. `POST /api/attendance/sessions`** — `new Date("banana").toISOString()`
throws `RangeError`; a non-numeric `durationMinutes` produced `NaN` and threw
the same way. Both are client-controlled. Now validated → 400.

**11. `requiredText()` called outside `try/catch`** in four places, so an
over-long field threw instead of returning a useful 400: faculty quiz
creation, quiz-session questions, subject creation (`department`/`semester`),
and student assignment submission text.

**12. `GET /api/shared/notes/:id/file`** crashed on `note.file.storedName` when
the note row had no file metadata.

**13. PDF report streaming** had no `error` handler and no client-disconnect
handling — a pdfkit error surfaced as an unhandled `'error'` event (process
kill) and left the response hanging.

## Data integrity

**14. `GET /api/admin/fees` wrote to the database.** GETs don't acquire
`databaseWriteLock`, and writes replace the *entire* database document — so
this raced any concurrent mutating request and could clobber it wholesale. The
backfill is in-memory only now; it persists via the next write-locked route.

**15. Deletes left orphans everywhere.** Deleting a student left their
attendance corrections, submissions, quiz attempts, marks, complaints, fee
records and notification state behind; deleting a subject left quizzes, marks
and live sessions pointing at nothing (so `/quiz/active` kept serving
questions for a deleted subject); deleting an assignment or quiz left its
submissions and attempts. All cascade now, and deletes 404 instead of silently
returning `ok: true` for a nonexistent id.

**16. Unvalidated field types.** `className`, `department`, `phone`,
`guardian`, `graduationYear`, `rollNumber` on student create/update, and
`className`/`dueDate` on assignments, were copied straight from the request
body — a JSON object or array landed in the stored record and broke every
consumer assuming a string.

**17. Missing guards:** no cap on batch size (now 500), correction requests
could be double-filed and re-approved after resolution, `amountPaid` could
exceed `amountDue`, duplicate subject code per class, teacher code collisions
on access-request approval, unvalidated `date` on the CSV export.

**18. Session list showed every session as seconds old** — refresh rotation
reset `createdAt` every 15 minutes. Original sign-in time now carries forward,
and `lastActiveAt` is updated.

**19. Signup OTP had a 10-minute TOCTOU window** where two people could each
hold a valid code for the same address. Uniqueness is re-checked at verify.

## Client

**20. Downloads never refreshed an expired token.** `apiDownload` skipped the
401 → refresh → retry path `apiFetch` has, so every CSV/PDF export failed with
"Download failed." after 15 minutes despite a valid refresh token.

**21. `downloadToFile` revoked the object URL in the same tick** as the click,
cancelling the download before the browser read from it; the anchor was also
never attached to the document, which Firefox requires.

**22. The 401 retry replayed a consumed `FormData` body**, sending an empty
upload. Now surfaces a clear error instead of a silently corrupt upload.

**23. Submission links were accepted if they merely started with `"http"`** —
`"httpfoo://..."` passed. Now parsed and restricted to `http:`/`https:`.

## Error handling

**24.** Blocked-CORS requests and oversized bodies were logged as "Unhandled
request error" and answered with 500. They're client errors: 403 and 413 now.
