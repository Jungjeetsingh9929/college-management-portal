# College Portal User and Role Audit

**Audit date:** 23 September 2026  
**Audit target:** `college-portal-round13-fixed-final.zip`  
**Audit mode:** Static inspection, automated tests, isolated local runtime, live browser smoke testing, and direct API permission checks.

## Executive conclusion

The portal’s current application logic is in a strong staging state. All automated tests passed, the production build passed, the isolated API started successfully, each documented role logged in through the browser, and the final 14-case server permission and edge-case matrix passed. Student, faculty, and administrator navigation matched their intended workspaces. The browser console was clean after the live smoke pass.

The exact archive should **not yet be distributed as a production or portfolio release** because it contains generated runtime data and uploads. The archive also requires correct deployment-origin configuration: during the first browser attempt, the API rejected the public frontend origin with `Origin is not allowed` until `CLIENT_ORIGIN` was set to the actual frontend origin. This is an operational configuration requirement rather than an authorization defect, but a deployment that omits it will make every browser login fail.

## Verification summary

| Area | Result | Evidence |
|---|---|---|
| Dependency installation | Passed | `npm ci --ignore-scripts` completed; 0 reported vulnerabilities |
| Automated regression/security suites | Passed | `npm test` exited 0; 18/18 suites passed in the packaged project’s test runner |
| Production frontend build | Passed | `npm run build` exited 0; only the known large-chunk warning remained |
| API health | Passed | `GET /api/health` returned HTTP 200 and `{ "ok": true }` |
| Student browser login and workspace | Passed after correct `CLIENT_ORIGIN` configuration | Student dashboard and navigation loaded |
| Faculty browser login and workspace | Passed | Faculty dashboard and class-scoped roster loaded |
| Admin browser login and workspace | Passed | Admin dashboard, subject management, and security center loaded |
| Browser runtime errors | Passed | No console output after the final multi-role pass |
| Direct API role matrix | Passed | 14/14 checks passed |
| Packaged release hygiene | Failed | Generated database and storage artifacts are included |

## Role-by-role findings

### Student experience

The student account logged in successfully through the browser and reached `/student`. The dashboard displayed the student identity, attendance percentage, class summary, pending assignments, fee status, timetable, academic pulse, notices, and the read-only student-record explanation.

The student workspace exposed the expected navigation: assignments, results, schedule, events, library, teachers, complaints, fees and payments, the student’s own record, attendance history, profile, year schedule, and account settings. The student assignments page loaded and correctly displayed an empty-state message when no assignments were available. The complaints page exposed title, category, location, priority, description, submission, filtering, and tracking controls. The fees page loaded the balance and payment-history state without exposing administrator fee controls.

The direct API checks confirmed that a student can access their own portal and public teacher records, but cannot access administrator fees, administrator security logs, or the faculty roster. The server returned HTTP 403 for each restricted operation. Students are not allowed to mark attendance directly; the dashboard explicitly presents attendance as read-only.

### Faculty experience

The documented faculty account logged in successfully through the browser and reached `/faculty`. The faculty dashboard displayed assigned classes, assigned subjects, the number of students in scope, open assignments, today’s timetable, and the assigned student-performance overview.

The faculty navigation exposed assignments, attendance center, manual attendance, QR attendance, class schedule, events, library, marks and results, notes and notices, complaints, year schedule, and account settings. The manual attendance page loaded a subject selector, date selector, seven-student class roster, and Present, Late, Excused, and Absent actions. The roster was scoped to the faculty member’s assigned class and subjects.

The direct API checks confirmed that the faculty account can view its scoped roster but cannot access administrator fees or security logs. The automated suites additionally cover attendance duplication, quiz sessions, class scope, assignments, marks ownership, and teacher authorization.

### Administrator experience

The administrator logged in successfully through the browser and reached `/admin`. The dashboard showed registered students, faculty, departments, subjects, scheduled classes, attendance totals, recent activity, security alerts, assignment activity, access requests, student ID requests, and a student-management table with status controls.

The administrator navigation exposed subjects, marks and results, attendance center, manual attendance, central timetable, schedules, events, library, teachers, fees and notices, departments and rooms, security center, photo approvals, complaints, history, reports, year schedule, and account settings.

The subject-management page loaded create, edit, and delete controls and a class-timing form. The security center loaded filters for dates, user or target, event type, and severity, together with failed-logins, active-sessions, recent-logins, suspicious-activity, lockout, and audit-log summaries. The direct API checks confirmed that the administrator can access both the fee center and security center.

## Direct permission and edge-case matrix

The live isolated API was tested with separate student, faculty, and administrator tokens. The results were as follows.

| Check | Expected | Actual | Result |
|---|---:|---:|---|
| Student views own portal | 200 | 200 | Passed |
| Student views public teachers | 200 | 200 | Passed |
| Student accesses admin fees | 403 | 403 | Passed |
| Student accesses admin security | 403 | 403 | Passed |
| Student accesses faculty roster | 403 | 403 | Passed |
| Faculty views scoped roster | 200 | 200 | Passed |
| Faculty accesses admin fees | 403 | 403 | Passed |
| Faculty accesses admin security | 403 | 403 | Passed |
| Administrator views fees | 200 | 200 | Passed |
| Administrator views security | 200 | 200 | Passed |
| Missing authentication token | 401 | 401 | Passed |
| Malformed array request body | 400 | 400 | Passed |
| Unknown API route | 404 | 404 | Passed |
| Wrong password | 401 | 401 | Passed |

## Confirmed findings and release risks

### Critical before release: generated runtime data is packaged

The archive contains `server/db/database.json` and generated files under `storage/`. The database is populated with student, faculty, administrator, attendance, schedule, complaint, guardian, email, audit, and password-hash data. Even if the data is synthetic, shipping generated operational state creates a privacy, credential, and deployment-contamination risk. If any record represents a real person, the issue must be treated as a potential privacy exposure.

Remove the generated database and upload artifacts from the release archive. Add them to `.gitignore`. Use a deliberately sanitized test fixture or a temporary test database instead. Rotate any credentials that may have been used outside an isolated environment, and scrub repository history if these artifacts were ever committed to a shared repository.

### High operational risk: JSON fallback is not suitable for shared operation

The application correctly requires PostgreSQL for intended production startup, but the local JSON fallback remains a single-document store. It is fragile under concurrent processes, shared staging, test parallelism, and accidental non-production deployment. Keep PostgreSQL as a hard production requirement and isolate the fallback database per test or per local process.

### Medium performance risk: large frontend bundle

The production build succeeded but still reports a large main JavaScript chunk of approximately 879 kB minified, or approximately 245 kB gzip according to the project’s existing audit notes. Route-level lazy loading is present in the route declarations, but the final bundle remains large. Measure a cold mobile load and split large chart, PDF, and shared UI dependencies if startup performance matters on campus networks.

### Medium deployment verification risk: browser origin must be configured

The first browser attempt failed because the API did not allow the sandbox’s public frontend origin. Setting `CLIENT_ORIGIN` to the exact frontend origin resolved the issue and allowed all role logins to complete. Every deployment must set `CLIENT_ORIGIN` or `FRONTEND_URL` to the actual browser origin, including scheme and host. This should be validated in deployment documentation and in a release smoke test.

### Low-to-medium environment risk: demo identities and seed data

The seed logic contains demo identities and extensive example records. The code has safeguards that make demo login opt-in for production, but production must keep `ALLOW_DEMO_LOGIN=false`, use operator-managed credentials, and never reuse the documented local passwords in a shared environment.

## Recommended next actions

1. Remove `server/db/database.json` and generated `storage/` files from the release archive and repository history where applicable.
2. Add release-hygiene checks that fail when generated runtime data or uploads are included.
3. Run the production deployment with PostgreSQL and verify that `CLIENT_ORIGIN` or `FRONTEND_URL` exactly matches the deployed frontend origin.
4. Repeat one browser smoke pass against the actual deployment using student, faculty, and administrator accounts. Capture login, refresh, logout, mobile layout, upload/download, QR attendance, geolocation, and payment-provider behavior.
5. Split the frontend bundle and measure cold-start performance on a representative mobile connection.
6. Keep demo login disabled in production and rotate any credential that has escaped the isolated test environment.

## Audit limitations

This audit did not use a real production PostgreSQL instance with multiple server processes. It did not submit a real payment, send external email, test physical-campus GPS, scan a QR code with a second physical device, or test accessibility with a dedicated automated accessibility engine. Those checks remain necessary before institutional production use.

## References

[1]: README.md "College Management Portal project README"

[2]: AUDIT_ROUND13.md "Round 13 audit notes included in the archive"

[3]: DEEP_AUDIT_REPORT.md "Deep bug, logic, security, and release audit included in the archive"

[4]: E2E_TEST_CREDENTIALS.md "Documented end-to-end test credential and access-scope notes"
