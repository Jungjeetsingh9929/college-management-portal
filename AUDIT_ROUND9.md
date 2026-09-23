# Deep Role-Based Audit — Round 9

## Scope

This pass combined adversarial source review with browser-level journeys for administrator, faculty, and student users. The review covered role login, dashboards, navigation, student-facing workflows, faculty-scoped workflows, timetable/subject contracts, attendance authorization, marks authorization, seeded data consistency, regression tests, and the production build.

## Newly confirmed and fixed issue

| Area | Finding | Fix |
|---|---|---|
| Faculty timetable, subjects, attendance, and marks | The seeded faculty account had timetable entries for **Operating Systems**, but the subject catalog did not contain a matching subject record. In addition, faculty ownership checks trusted only the subject's free-text professor field. The timetable therefore displayed a class that could not be selected for attendance or marks, creating a broken user journey and inconsistent authorization model. | Added the missing subject seed record and introduced a timetable-aware `subjectAssignedToTeacher` rule. Faculty dashboard scope, assignment/session creation, attendance roster/mark/batch/session checks, and marks-sheet access now use the same consistent ownership rule while preserving class scoping. |

## Browser verification

The local portal was tested with fresh deterministic accounts. The admin workspace loaded and its major management pages were smoke-tested, including subjects, marks, attendance, timetable, events, library, teachers, fees, and resources. The faculty account reached its dashboard and showed both scheduled subjects consistently in the portal response. The student account reached its dashboard and was tested across assignments, results, schedule, events, library, complaints, fees, student record, attendance history, and profile. No new browser runtime failure, role redirect failure, or visible access-scope violation was confirmed.

## Automated verification

The complete regression run passed with **16/16 suites**. The Round 8 boundary suite passed, including invalid dates, orphan subject references, schedule validation, and attendance correction boundaries. The production Vite build passed. The build continues to emit only the known non-functional large-chunk warning for the approximately 879 kB main JavaScript bundle.

## Conclusion

The additional confirmed logic mismatch is fixed and covered by the existing regression suite plus direct faculty API contract verification. Based on the source audit, role journeys, endpoint checks, and build verification completed in this pass, no further confirmed admin, faculty, or student loophole was found in the reviewed flows.
