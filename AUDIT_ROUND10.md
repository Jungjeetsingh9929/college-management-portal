# Deep Role-Based Audit — Round 10

## Scope

This pass focused on cross-role information disclosure, frontend/API contract mismatches, filter-metadata leakage, quiz ownership, malformed administrative references, and regression isolation. It reviewed the shared search index, subjects and schedules APIs, quiz retrieval, department administration, route consumers, and existing test coverage.

## Newly confirmed and fixed issues

| Area | Finding | Fix |
|---|---|---|
| Faculty global search | A faculty member's search index filtered subjects only by class. A teacher assigned to one subject could discover unrelated subjects in the same class. | Search subject entries now require timetable-aware subject ownership for the logged-in faculty member. |
| Subjects API | `/api/subjects` returned the complete subject and class catalog to every authenticated role. Students and faculty could enumerate unrelated classes and subjects even though the UI later filtered some results. | Admins retain the full catalog; students receive only their class; faculty receive only their taught classes and owned subjects, with class records filtered to those subjects. |
| Schedule metadata | Student schedule rows were class-scoped, but `sections`, `faculty`, `classrooms`, departments, and semesters in the same response were built from the entire college timetable. | Filter metadata is now derived from the already-visible schedule rows. |
| Quiz retrieval | A faculty member could retrieve another teacher's quiz questions by ID when both teachers taught the same class. | Faculty quiz retrieval now requires quiz authorship; students remain class-scoped and admins retain support access. |
| Department HOD integrity | Admin department create/update accepted arbitrary HOD IDs, creating departments that pointed to nonexistent faculty accounts. Reassigning a HOD could also leave a stale HOD pointer in the previous department. | HOD IDs must resolve to an existing faculty account; reassignment clears the previous department pointer and keeps faculty department identity consistent. |

## Verification

A new Round 10 scope regression suite covers class-scoped subjects, schedule metadata, faculty search scope, and dangling-HOD rejection. The complete automated suite passed with **17/17 suites**. Dependency audit reported **zero high-severity vulnerabilities**, all server JavaScript syntax checks passed, and the production Vite build passed.

The first full run was intentionally treated as invalid because a resident local development server was concurrently using the shared JSON test database, causing a fixture login race. The service was stopped and the complete suite was rerun in isolation; the isolated run passed all 17 suites.

The build continues to emit only the known non-functional large-chunk warning for the approximately 879 kB main JavaScript bundle.

## Conclusion

This pass found additional real cross-role disclosure and data-integrity defects and corrected them with regression coverage. No further confirmed loophole was found in the reviewed search, subjects, schedules, quizzes, department administration, and related role-scoped API contracts.
