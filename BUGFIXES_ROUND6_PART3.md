# Round 6 — Cross-student device-fingerprint check (fix #7 from Audit Round 6)

Scope: implements finding #7 from `AUDIT_ROUND_6_REPORT.md` — the QR/geofence
check-in's device-risk signal only ever compared a fingerprint against that
*same* student's own previous value, so it could never catch the classic
"buddy punching" case: one student's phone checking in several absent
friends' accounts one after another. Each friend's account has no prior
stored fingerprint, so the old per-student mismatch condition never fired
the first time an account was used — which is exactly the scenario being
exploited.

`npm install`/`npm test` could not be run in this sandbox (no network, no
`node_modules`). The touched file was checked with `node --check`.

## Fix #7 — `POST /attendance/check-in`

Added a second, independent risk signal alongside the existing per-student
check: before writing the new attendance record, look at whether the
submitted `deviceFingerprint` has already been used to check in a
*different* student for the *same session*:

```js
const sharedWithOtherStudent = Boolean(deviceFingerprint) &&
  (db.attendance || []).some((i) => i.sessionId === sessionId
    && i.studentId !== req.user.id
    && i.deviceFingerprint === deviceFingerprint);
```

If it has, `riskLevel` is forced to `"high"` (same as the existing
own-device-changed case) and the review-queue entry is tagged with its own
reason, `"shared-device"`, instead of `"device-risk"`, so the two causes stay
distinguishable in the HOD/admin review queue:

```js
reason: sharedWithOtherStudent ? "shared-device" : "device-risk"
```

No client change was needed — `AttendanceCommandCenter.jsx` already renders
`item.reason` as plain text in the exception queue, so the new reason string
just shows up there.

This only adds a *signal*; nothing about check-in is blocked or rejected
because of it, matching the audit's suggestion to route it into the same
review queue rather than hard-fail the request (a false positive here — e.g.
two students briefly sharing a phone to help one of them retry a failed
scan — shouldn't lock either of them out of attendance, just get flagged for
a human to look at).

## Not touched in this round

Findings #5 (filename sanitization), #6 (GPS self-report, a flagged
discussion item, not a code fix), and #8 (stale HOD status on the client)
are unchanged — next up per the audit's suggested order is #8, then #5.
