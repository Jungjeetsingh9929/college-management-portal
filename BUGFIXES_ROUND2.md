# Bug fixes — round 2: concurrency & storage

Scope: `server/db/fileStore.js` (the write lock, `writeDb`'s read-modify-write
pattern, Postgres vs. file-store divergence, multi-instance behavior).

All changes are in `server/db/fileStore.js` unless noted, with inline
comments explaining why. No route file, response shape, or API path changed.

## 1. The write lock did nothing across multiple server instances (the headline bug)

`databaseWriteLock` serialized mutating requests using `requestLock`, a
module-level variable. That works within one Node process — but the whole
point of the Postgres backend here is to support 2+ Render instances sharing
one database (the distributed rate-limit table and the Postgres file storage
both say so in their own comments). Each instance has its **own** copy of
`requestLock`, which knows nothing about the others.

Concretely: Admin on instance 1 approves student X's access request at the
same moment Admin on instance 2 approves student Y's. Both instances
`readDb()` the same pre-update state, both mutate their own in-memory copy,
both `writeDb()`. Whichever write lands second **completely overwrites** the
first — not just the students collection, the entire database document,
since it's one JSON blob in one row. Student X's approval silently vanishes.
The same race applies to attendance marks, fee payments, literally every
mutation, with no error and nothing in the logs to notice it by.

**Fix:** added a real Postgres advisory lock (`pg_advisory_lock`), held on a
single dedicated connection, acquired before the existing in-process
`requestLock` chain hands a request its turn and released when that request's
lock window closes. Advisory locks are visible to every session on the same
database (i.e., every instance) and auto-release if the holding connection
dies, so a crash or redeploy can never strand the lock the way a "locked"
flag row in a table could. In file-store mode (no `DATABASE_URL`, dev/test)
this is a no-op — there's only ever one process, so nothing changes there,
which is why the existing test suite exercises identical code to before.

## 2. No cap on how long a request could hold the lock

Related to #1: nothing stopped a single slow or hung request from holding
the write lock (now correctly a cross-instance lock) forever, freezing every
mutating endpoint in the app for every user. This wasn't hypothetical — see
#5 below for a concrete way to trigger it that already existed in the code.

**Fix:** `WRITE_LOCK_TIMEOUT_MS` (default 30s, overridable via env) force-
releases the lock and logs loudly if a request hasn't finished by then. The
original request can still complete afterward; this just stops it from
blocking everyone else's writes indefinitely.

## 3. Seed-row insert crashed on concurrent first boot

`initializeDatabase()` did a plain `SELECT` then, if no row existed,
`INSERT INTO ... VALUES (1, ...)`. If two instances boot against a brand-new
database at once — a normal outcome of a fresh deploy that scales straight to
2+ instances — both see `rowCount === 0` and both try to insert `id = 1`. The
loser hits an unhandled unique-violation and crashes on startup.

**Fix:** `INSERT ... ON CONFLICT (id) DO NOTHING RETURNING id`. The losing
instance now just falls through to the "already seeded" branch instead of
throwing.

## 4. A failed boot was cached forever

`ensureDatabase()` cached `initializeDatabase()`'s promise in a module-level
variable and never cleared it. If Postgres was briefly unreachable during
boot (a very plausible transient condition against a managed database), that
first rejection stayed cached — every subsequent `readDb()`/`writeDb()` call
would immediately reject with the same stale error forever, even long after
the database was reachable again. The app would need a manual restart to
recover from what should have been a self-healing blip.

**Fix:** clear the cached promise on failure so the next call retries.

## 5. Unbounded SMTP calls held the write lock

`emailService.js`'s nodemailer transport had no `connectionTimeout`,
`greetingTimeout`, or `socketTimeout`. OTP delivery and fee-reminder emails
send *after* the state is already written but *before* the response is sent
— and the write lock isn't released until the response finishes — so an SMTP
server that accepts a TCP connection but never responds (common failure mode
for a misconfigured or rate-limiting mail host) hung the request indefinitely
and, per #1/#2, would have hung the lock along with it.

**Fix:** added explicit timeouts (10–15s) to the transporter config, well
under the lock's 30s force-release ceiling, so this fails fast with a real
error instead of hanging.

## 6. Pool and lock connections had no timeout of their own, and no error handler

Two related gaps:

- `pg.Pool` emits an `'error'` event whenever an *idle* client's connection
  drops (DB restart, network blip, managed-Postgres failover). With no
  listener, Node treats this as an uncaught exception and **kills the whole
  process** — taking down every in-flight request, not just whichever one
  happened to be on that connection. Added a listener that logs and lets the
  pool reconnect on its next checkout.
- Neither the `Pool` nor the new dedicated lock `Client` had
  `connectionTimeoutMillis` set. Against a fully unreachable Postgres (not
  just slow — genuinely unreachable, e.g. a network black hole), a connection
  attempt can hang indefinitely rather than failing. Combined with the old
  unbounded retry loop in the advisory-lock acquisition, this meant a fully
  down database wouldn't surface as an error — it would just hang every
  request forever. Added `connectionTimeoutMillis` to both, and bounded the
  lock-acquisition retry loop by the same `WRITE_LOCK_TIMEOUT_MS` ceiling so
  it eventually throws instead of looping forever.

## 7. Stale temp files on a failed file-mode write

`atomicWrite`'s file-store path writes to `database.json.<pid>.tmp` then
renames it over `database.json`. The rename is atomic, so `database.json`
itself could never end up half-written — but a failure between the write and
the rename (disk full, a permissions error) left the temp file behind
forever. Per-pid naming meant these silently accumulated across repeated
failures or dev restarts instead of colliding, which just hid the problem
rather than surfacing it.

**Fix:** wrapped in try/finally so a failed write cleans up its own temp file
before re-throwing.

## Checked, found sound — no change needed

- **`server/middleware/rateLimit.js`'s Postgres path** — already correctly
  built for multiple instances: each check is a single atomic
  `INSERT ... ON CONFLICT DO UPDATE` statement, so Postgres's own row-level
  locking handles the concurrent-request case correctly with no
  read-modify-write gap. Nothing to fix here.
- **`server/db/blobStore.js`** — file bytes are stored keyed by a random
  `storedName` via a single atomic upsert/select/delete per file; there's no
  multi-step read-modify-write pattern, so no race is possible here the way
  it was for the single-row JSON state. Worth noting as a lower-severity
  observation: a large file upload to the Postgres backend happens while the
  route (a POST) is holding the write lock, so a slow upload could occupy the
  lock for a while — bounded now by the same 30s timeout from #2, but if
  you expect large uploads regularly, consider moving file storage outside
  the locked window in a future round.
- **No other GET route writes to the database.** Swept every route file for
  a `.get()` handler calling `writeDb()` — the one instance of this
  (`GET /api/admin/fees`) was already fixed in round 1.

## Needs your decision

- **`WRITE_LOCK_TIMEOUT_MS` default of 30 seconds.** This is a genuine
  tradeoff: force-releasing lets the app keep serving other writes instead of
  freezing entirely, but it means a very slow legitimate request (e.g. a huge
  attendance batch or file upload) could theoretically overlap with the next
  request's write if it runs past 30s. If your typical uploads or batches can
  legitimately take longer than that, raise `WRITE_LOCK_TIMEOUT_MS` via env
  rather than lowering the safety margin elsewhere. I picked 30s as a
  generous default that should never trigger under normal load.
- **The advisory-lock key (`727476551`)** is a fixed constant shared by every
  instance. If any other process ever takes advisory locks against the same
  Postgres database for an unrelated purpose, make sure it doesn't reuse this
  exact key.
