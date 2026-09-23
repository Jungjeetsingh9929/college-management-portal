# User-Visible Audit — Round 11

## Scope

This pass tested the portal as real administrator, faculty, and student users rather than only reviewing API authorization. It covered login role selection, dashboard rendering, navigation, visible statistics, empty states, fee presentation, timetable presentation, profile controls, assignments, and browser-console runtime output.

## Confirmed user-visible defects fixed

| Role | Finding | Fix |
|---|---|---|
| Administrator | Attendance totals were labelled **Present marks** and **Absent marks**, although they represented attendance records. This was misleading on the main operations dashboard. | Labels now read **Present attendance** and **Absent attendance**, with the hint **All attendance logs**. |
| Student | A student whose fee status was `paid` saw the contradictory hint **No fee notice published** on the dashboard. | Paid accounts now show **No outstanding balance** and use the success/green visual treatment. The no-notice message remains only for the `not-published` state. |

## Journey verification

The administrator journey reached the operations dashboard and rendered the management navigation, campus statistics, recent activity, security alerts, assignment activity, access requests, student approval requests, and student table. The faculty journey reached the scoped teacher workspace with assigned subjects, students, timetable, quick actions, and notifications. The student journey reached the dashboard, assignments, fees, profile, and schedule pages; the dashboard now displays the corrected paid-fee message. The timetable showed the student's class schedule, including Friday rows in the weekly table. No browser console errors were observed during the journeys.

## Automated verification

The isolated full regression run passed with **17/17 test suites**. Dependency audit reported **zero high-severity vulnerabilities**, and the production build passed. The build continues to emit only the known non-functional large-chunk warning for the approximately 879 kB main JavaScript bundle.

## Conclusion

The confirmed user-facing wording and visual-state defects from this pass are fixed. No additional confirmed visible navigation, role-screen, loading, empty-state, or browser-runtime defect was found in the tested admin, faculty, and student journeys.
