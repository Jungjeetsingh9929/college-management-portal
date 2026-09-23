# College Portal Deep Bug, Logic, Security, and Release Audit

**Audit target:** `college-portal-round13-fixed(1).zip`  
**Audit date:** 2026-09-23  
**Scope:** repository inventory, server and client logic, authentication and authorization, persistence and concurrency, validation, uploads, payment/attendance/assignment workflows, automated tests, production build, dependency audit, startup behavior, and packaged artifacts.

## Executive summary

The application is in a substantially improved state. The complete automated suite passed **18/18 test suites**, server-side JavaScript syntax validation passed, the production Vite build passed, and `npm audit --audit-level=high` reported **zero vulnerabilities**. The development server also started successfully and returned `GET /api/health` with `{ "ok": true, "service": "College Management API" }`.

However, the submitted archive is **not release-clean**. It contains a generated runtime database at `server/db/database.json` and generated upload files under `storage/`. The database is not an empty fixture: it contains 67 student records, 117 faculty records, 3 administrators, 2,120 attendance records, 2 complaints, 1,154 schedules, 8 audit records, guardian names, email addresses, and bcrypt password hashes. Even if the records are synthetic, this is a serious data-governance and deployment-contamination risk. If any names or records correspond to real people, this is a privacy incident risk.

No additional high-confidence authorization bypass, token-forgery defect, SQL injection, plaintext-password exposure, or assignment/quiz/attendance state-corruption bug was confirmed in this pass. The remaining issues are primarily release hygiene, operational resilience, and performance/accessibility follow-up.

## Severity summary

| ID | Severity | Area | Status |
|---|---:|---|---|
| F-01 | **Critical before release** | Packaged runtime database and generated uploads | Confirmed |
| F-02 | High operational risk | Single JSON document remains a fragile fallback and test-state surface | Confirmed architectural risk; production is blocked without PostgreSQL |
| F-03 | Medium | Main frontend bundle is oversized | Confirmed build warning |
| F-04 | Medium | Browser/live deployment verification is incomplete | Confirmed verification gap |
| F-05 | Low | Demo/test identity and seeded data must be isolated from shared environments | Confirmed configuration risk; mitigations exist |
| F-06 | Informational | Startup checks can fail on the first missing secret before reporting all missing production settings | Confirmed behavior, not a security bypass |

## Confirmed findings

### F-01 — Generated database and upload artifacts are included in the deliverable

**Severity: Critical before release**

**Evidence:**

- `server/db/database.json` is present in the submitted archive and is approximately 1.16 MB.
- The database contains 67 students, 117 teachers, 3 admins, 2,120 attendance rows, 2 complaints, 1,154 schedules, 22 departments, 14 fee structures, and 8 audit logs.
- Example fields include student names, email addresses, roll numbers, guardian names, class/department information, attendance dates, complaint descriptions, and bcrypt password hashes.
- `storage/submissions/` contains generated PDF artifacts.
- The project README itself says generated database files and user records must not be committed, but the archive contradicts that rule.

**Why this matters:**

The production code correctly requires `DATABASE_URL` in production, but the archive can still be opened, copied, scanned, backed up, or accidentally deployed in development/staging. The fallback store also reads this exact file (`server/db/fileStore.js:9–11`), so local runs and tests can mutate the submitted state. The audit run itself left fresh audit records in the packaged database, demonstrating that this is live/generated state rather than a clean immutable fixture.

**Remediation:**

1. Remove `server/db/database.json` and generated `storage/` files from the release archive.
2. Add them to `.gitignore` and provide a deliberately sanitized fixture under a separate test-only path if needed.
3. Rotate every credential whose hash or corresponding password may have been used outside an isolated local environment.
4. If any records are real, treat this as a potential privacy exposure: identify recipients/history, remove the artifact from distribution and repository history, and rotate affected credentials.
5. Make tests use a temporary database path or an isolated temporary directory rather than the repository runtime database.

### F-02 — Single-document JSON persistence remains unsafe for concurrent or multi-process operation outside the guarded production path

**Severity: High operational risk**

The project has made a serious effort to serialize writes through `databaseWriteLock` and `withWriteLock`, and the current tests cover the important single-process paths. Nevertheless, the fallback store models all state as one JSON document. Any code path that reads, mutates, and writes outside the common lock can overwrite unrelated changes; cross-process use of the JSON fallback cannot be made safe by an in-process promise.

Production startup rejects missing `DATABASE_URL` (`server/db/fileStore.js:11`), which prevents this from being the intended production store. The risk remains relevant for staging, local shared environments, test parallelism, accidental non-production deployment, and future horizontal scaling.

**Remediation:** keep the production PostgreSQL requirement; make the test store per-process/per-test; add a startup warning or hard failure when the JSON fallback is used outside an explicitly local/test environment; continue migrating important state from the single JSON blob to normalized transactional tables.

### F-03 — Frontend bundle exceeds Vite’s recommended chunk size

**Severity: Medium**

The production build succeeds, but Vite reports:

> Some chunks are larger than 500 kB after minification.

The main JavaScript bundle is approximately **879.27 kB** minified, **244.88 kB gzip**. All pages are loaded into one large bundle, which increases first-load time, mobile memory pressure, and time-to-interactive on slower campus networks.

**Remediation:** use route-level `import()`/React lazy loading, split large chart/PDF/UI dependencies through Rollup `manualChunks`, and measure mobile cold-start performance before release.

### F-04 — Browser and live-deployment verification is still incomplete

**Severity: Medium**

The code-level and API-level evidence is strong, but the archive does not include a browser automation result for the final build/deployment. The existing checklist also notes that live Render health and browser console verification were not fully confirmed. The current local health check passed, but that does not prove:

- production asset serving and SPA fallback;
- browser console cleanliness;
- mobile sidebar and navigation behavior;
- real login/refresh/logout behavior in a browser;
- QR scan flow on a second device;
- geolocation permission/error handling;
- upload/download behavior against production storage;
- payment-provider webhook behavior in the deployed environment.

**Remediation:** perform one browser smoke pass against the actual deployment and capture console/network results for admin, teacher/HOD, and student roles. Test on a narrow mobile viewport and a second device for the QR attendance flow.

### F-05 — Demo identities and seed records require strict environment isolation

**Severity: Low to Medium depending on deployment configuration**

The seed logic has good protections: demo login is opt-in in production (`server/db/seedData.js:765–770`), production secrets are required, and the README warns against predictable shared passwords. Nevertheless, the seed module contains extensive demo records and supports shared demo identities when `ALLOW_DEMO_LOGIN` is enabled. The packaged database also contains seeded accounts and data.

**Remediation:** keep `ALLOW_DEMO_LOGIN=false` in production, use unique operator-managed passwords, do not reuse demo emails in any shared environment, and ensure the seed file is never used as a source of real institutional data.

### F-06 — Production configuration validation is sequential rather than aggregated

**Severity: Informational**

A production startup attempt without required environment variables failed first with:

> `Error: SEED_ADMIN_PASSWORD must be set in production.`

The application therefore stops safely, but an operator may need multiple deploy cycles to discover all missing settings because validation occurs during module initialization rather than as one aggregated configuration report. This is not an access-control defect.

**Remediation:** add a dedicated preflight configuration validator that reports all missing/invalid production variables in one error, before importing modules that construct seed data.

## Logic and security areas checked with no confirmed defect

### Authentication and sessions

The review found issuer, audience, and algorithm restrictions on JWT verification (`server/middleware/auth.js:51`), access-token type checking, password-version invalidation, hashed refresh-token storage, refresh-token rotation, logout revocation, and password-history checks. The automated authentication hardening suites passed.

### Authorization and role boundaries

Protected route coverage was reviewed across admin, student, teacher, HOD, attendance, marks, assignments, photos, projects, complaints, reports, library, and payment routes. The tests passed for RBAC boundaries, marks ownership, assignment workflows, quiz sessions, and round-specific scope regressions. Student-facing routes generally enforce ownership/class checks, and teacher routes check authored or assigned records.

### Attendance and quiz state transitions

The review checked duplicate prevention, batch idempotency, QR nonce replay protection, geofencing, class/subject scope, quiz attempt uniqueness, and server-side correctness checks. The tests passed. The client also keeps the quiz submit button disabled across the full GPS-and-submit cycle.

### Assignment submissions

The server validates submission text length, accepts only parseable `http:`/`https:` links (`server/routes/shared.js:403–415`), checks class membership, deadline, existing completion, and grading state. Submission downloads are authorization-checked and use stored-name lookups rather than trusting arbitrary filesystem paths.

### Upload handling

Upload validation tests passed. The code uses isolated category roots, validates file metadata, and serves protected files through authenticated routes. The included generated files are still a release-hygiene problem even though the runtime upload controls are improved.

### Payments

Payment tests and API tests passed, including receipt ownership and webhook signature/idempotency paths. No payment authorization bypass was confirmed. Live provider configuration and webhook delivery remain deployment-level concerns.

### Input/output safety

No plaintext passwords were found in API serialization paths reviewed. CSV export protection and upload validation tests passed. React-rendered text is escaped by default, and no `dangerouslySetInnerHTML` use was found in the scanned source.

## Verification performed

| Check | Result |
|---|---:|
| Archive extraction and file inventory | Passed |
| Repository exhaustive audit script | Ran; route inventory produced; no failure signal |
| `npm ci --ignore-scripts` | Passed |
| `npm test` | **Passed: 18/18 suites** |
| Server/test JavaScript `node --check` | Passed |
| `npm run build` after dependency installation | Passed |
| Production build output | Main JS 879.27 kB minified; Vite chunk warning |
| `npm audit --audit-level=high` | **0 vulnerabilities** |
| Development server startup | Passed |
| `GET /api/health` | Passed with HTTP 200 |
| Production startup without required configuration | Safely rejected; first missing secret reported |
| Browser console/live deployment smoke test | Not performed in this sandbox |
| Real PostgreSQL multi-instance/concurrency test | Not performed; code review only |

## Final release decision

**Do not distribute this exact archive as a production or portfolio release.** First remove the generated database and storage artifacts, scrub repository history if this was ever committed elsewhere, rotate potentially exposed credentials, and rerun the test suite from a clean temporary data directory. After that, complete one browser-based smoke pass against the actual deployment.

After those actions, the current codebase appears suitable for continued staging validation: the automated API/security/regression coverage is strong, no high-confidence logic bypass was found in this pass, and the remaining code-level improvement is primarily frontend bundle splitting and a more explicit production configuration preflight.

## Audit limitations

This was a static and local-runtime audit of the submitted archive. It did not include authenticated browser interaction against a live deployment, real campus GPS testing, a live payment provider, a production PostgreSQL instance with multiple Node processes, accessibility tooling, load testing, or source-history review outside the submitted archive.
