# Concurrency & Race-Condition Audit — Findings

Scope: targeted pass over the concurrency-sensitive hotspots called out in
`implementation_plan.md` (quiz answer submission, attendance marking,
assignment submission), plus the app-wide write-serialization mechanism.

Note: `npm install` / `npm test` / `npm run dev` are not available in this
sandbox, so this is a careful read of the code paths, not a rerun of the
project's automated or manual verification plan. Run that yourself before
merging.

## Fixed

### `client/src/pages/QuizAnswer.jsx` — submit button re-enabled mid-flight

The submit button was disabled only while `locating` was true (i.e. only
during the GPS lookup). As soon as coordinates resolved, `locating` flipped
back to `false` — before the POST to `/shared/student/quiz/:id/answer` had
actually completed. That left a window where a fast double-tap, or just a
slow network, could fire a second submit request while the first was still
in flight.

Impact was limited: the server already rejects a second answer with a 409
(`shared.js` — "You have already submitted an answer for this quiz."), and
the process-wide `databaseWriteLock` serializes the two requests so there's
no way for both to be applied. So this couldn't corrupt data or produce a
duplicate record — but the user would see a confusing "already submitted"
error appear from nowhere, with no obvious cause.

**Fix:** added a `submitting` state that spans the whole GPS-lookup-and-POST
cycle (set before `getLocation()`, cleared in a `finally`), and gated the
button's `disabled` prop on `submitting` instead of `locating`. The button
label still distinguishes "Checking your location..." vs "Submitting..." for
clarity.

## Checked — already solid, left alone

- **`databaseWriteLock`** (`server/db/fileStore.js`, mounted globally in
  `server/index.js`): genuinely serializes every write request process-wide.
  This is the real mechanism preventing double-submit / lost-update races
  app-wide, not just a UI affordance.
- **Assignment submission** (`server/routes/shared.js`): both the
  text-answer and file-upload submission endpoints check `isPastDeadline()`
  and an "already submitted" flag, each returning the appropriate 403/409
  before any write.
- **QR check-in nonce replay guard** (`server/routes/attendance.js`,
  `/check-in`): rejects a reused `nonce` with 409 before marking attendance,
  in addition to session/QR-token/time-window/geofence checks.
- **Batch attendance idempotency key** (`server/routes/attendance.js`,
  `/batch`): a repeated `idempotencyKey` returns the previously-computed
  response (`replayed: true`) instead of reprocessing.
- **Refresh-token rotation** and **role-based route gating**: reviewed, no
  issues found.

## Known, not fixed (architectural — out of scope for a code edit)

The app stores all state as a single JSON blob, and `databaseWriteLock` only
serializes writes within one Node process. That's fine for the current
single-instance deployment. It would become a real lost-update risk only if
this were horizontally scaled across multiple instances without first moving
off the single-blob model — worth keeping in mind if that's ever on the
roadmap, but not something to change now.
