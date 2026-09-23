# Deep Role-Based Audit — Round 7

## Scope

This pass reviewed the portal as a role-based system across **administrator**, **faculty**, **HOD**, and **student** workflows. The review covered route middleware, subject/class ownership, attendance and quiz mutations, assignment deadlines, student approval, timetable integrity, file access, project state transitions, and the existing automated regression suites.

## Confirmed defects fixed

| Area | Defect | Impact | Resolution |
|---|---|---|---|
| Faculty attendance and quiz workflows | A teacher was authorized by class membership alone. If another teacher owned a subject in the same class, the first teacher could mark attendance, create a legacy attendance quiz, or start a QR question session for that subject. | Unauthorized attendance records and attendance-granting quizzes could be created. | Faculty access now requires both a taught class and explicit subject ownership via the normalized teacher-code parser. Admin access remains unchanged. |
| Student assignment status | A date-only deadline exactly three calendar days away could appear as `upcoming` late in the current day because the server compared the deadline timestamp to the current timestamp. | Students saw the wrong urgency bucket and could miss the “due soon” signal. | Date-only deadlines now use calendar-day distance; full datetime deadlines retain timestamp semantics. |
| Admin timetable management | Admins could create or retarget a class-timing row to a subject ID that did not exist. | The timetable could contain dangling records that could not be reconciled with subjects. | Create and update now return `404 Subject not found` for unknown subject IDs. |
| Pending student approval | Approval of a pending student request did not re-check email or roll-number uniqueness. | A request could create duplicate identities even though direct admin student creation checked uniqueness. | Approval now rejects duplicate email or roll number before writing the student record. Rejection reasons are also type-checked and bounded. |
| Regression test harness | The project workflow test always parsed download responses as JSON, so a valid PDF response caused the test itself to crash. | The suite reported a false failure after a successful authorized file download. | The helper now parses JSON only when the response content type is JSON. |

## Existing protections verified

The audit also verified that the following controls are present and functioning in the current codebase: JWT issuer/audience/algorithm checks; active-account and password-version checks; refresh-token rotation and replay revocation; student self-service record scoping; faculty class scoping for students, assignments, notes, and projects; admin-only management mutations; HOD department scoping; quiz correct-answer redaction; campus geofence validation; duplicate attendance prevention; QR nonce replay protection; batch attendance idempotency; assignment submission ownership and grading locks; project document authorization; and project blob cleanup after removing stale test artifacts.

## Verification

The existing suite was rerun after clearing local test storage so stale files could not contaminate project cleanup checks. The frontend production build was also run. The build completes successfully; Vite still reports the known performance warning that the main JavaScript bundle is larger than 500 kB. That warning is not a functional or authorization failure.

## Residual recommendations

The remaining items are not confirmed blockers in this pass: add browser-level CI journeys for all roles, add explicit tests for teacher subject ownership, split the frontend bundle by route, replace the third-party QR image dependency where applicable, and validate production deployment with real PostgreSQL and configured origins.
