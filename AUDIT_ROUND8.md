# Exhaustive Adversarial Audit — Round 8

## Scope

This pass treated the portal as an attacker and as each supported user: administrator, faculty, HOD, and student. It enumerated server routes and frontend API calls, inspected role middleware and ownership checks, searched for unsafe request-to-database flows, reviewed file-download authorization, validated state transitions, ran dependency and syntax checks, and added boundary regression coverage.

## Newly confirmed and fixed issues

| Area | Finding | Fix |
|---|---|---|
| Attendance dashboard | The dedicated review-queue endpoint was scoped for faculty, but the attendance dashboard embedded all open review flags. A faculty member could therefore see high-risk check-ins belonging to unrelated classes. | Dashboard queue output now uses the same teacher-visible student set as the rest of the attendance staff surface. |
| Attendance corrections | A faculty member could create a correction request and approve that same request, bypassing separation of duties. | Faculty approval is rejected when `requestedBy` equals the approving teacher. Admins and other authorized reviewers retain the intended workflow. |
| Date validation | JavaScript normalized impossible dates such as `2026-02-31` instead of rejecting them. | Attendance and event date parsing now round-trips the ISO date and rejects calendar-invalid values. |
| Subject timetable | Subject class-timing records accepted invalid weekdays, malformed times, and end times before or equal to start times. | Create and update validate weekday enums, `HH:mm` values, and chronological order. Unknown subject IDs are rejected. |
| Central timetable | Central schedule records accepted reverse-time intervals. | Create and update now require end time after start time. |
| Upload persistence | Student submission and faculty note blobs were saved before database persistence; a database write failure could leave orphaned files. | Failed database writes now remove the newly saved blobs. |

## Deliberate behavior retained

The audit initially considered rejecting arbitrary class labels for administrator-authored event/library audiences. Existing tests and the established contract intentionally permit administrators to manage labels that may be maintained outside the current student roster. That behavior was retained; faculty audiences remain restricted to classes they teach.

## Security and integrity checks completed

The review verified role middleware coverage across all route modules, student self-scoping, faculty ownership and class scoping, HOD department boundaries, admin-only mutations, password/refresh-token invalidation, payment amount ownership, receipt authorization, quiz answer redaction, project document access, assignment submission ownership, file signature validation, upload limits, path-key validation, CSV formula-injection escaping, and project/student blob cleanup.

`npm audit --omit=dev --audit-level=high` reported **zero vulnerabilities**, and all modified server files passed Node syntax checks.

## Verification

The added boundary suite passed. The complete regression suite passed with **16/16 suites**, including the new Round 8 boundary suite. The production Vite build passed. Vite continues to report a non-functional bundle-size warning for the approximately 879 kB main JavaScript chunk; route-level code splitting remains a performance recommendation, not a correctness defect.

## Residual engineering recommendations

For further operational confidence, add browser-level journeys against a deployed PostgreSQL instance, add explicit tests for faculty self-approval and dashboard queue isolation with two departments, introduce route-level code splitting, and monitor storage cleanup failures. No additional confirmed role or logic loophole was found in this pass.
