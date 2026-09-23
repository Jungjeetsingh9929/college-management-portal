# Comprehensive User-Facing Logic Audit — Round 12

## Scope

This pass audited the portal as an end user across administrator, faculty, student, and HOD-visible flows. The review compared visible labels, counters, date calculations, timetable state, assignment state, authentication transitions, filters, empty states, navigation targets, and mutation contracts against the underlying API behavior. Browser journeys covered login, stale-session recovery, dashboards, assignments, fees, profile, and timetable screens. Static inspection covered all frontend pages, visible API calls, route guards, and response fields.

## Newly confirmed and fixed issues

| Area | User-visible problem | Fix |
|---|---|---|
| Faculty dashboard | Assignments due on the current calendar date were counted as overdue because the client compared a date-only deadline to the current timestamp at midnight. | Added calendar-date overdue logic shared by the faculty dashboard and assignment page. An assignment becomes overdue only after its due date has passed. |
| Faculty/student assignment pages | Date-only deadlines were rendered through `toLocaleString()`, exposing an artificial midnight/time-zone time instead of a clear calendar date. | Added a shared date-only formatter and changed assignment pages to display the deadline as a calendar date. |
| Faculty submission review | A submission made during the deadline day could be labelled late because the completion timestamp was compared with the deadline’s midnight timestamp. | Added calendar-aware late-submission comparison; submissions on the due date are no longer incorrectly labelled late. |
| Authentication bootstrap | An expired token could produce duplicate **Invalid or expired token** notifications on the login page when the application silently restored the session. | Authentication bootstrap requests are now silent; stale-session cleanup no longer creates user-facing duplicate error toasts. |
| Student timetable | A class remained labelled **Current** at the exact end minute. | The current interval is now end-exclusive; the class becomes completed at its end time. |

## Role-flow findings

The administrator dashboard rendered management statistics, activity, security alerts, assignment activity, access requests, approval requests, and student management controls. Faculty views remained scoped to assigned classes, subjects, students, schedules, assignments, notes, marks, and notices. Student views exposed only the student’s own record, assignments, attendance, fees, profile, schedule, notices, and learning resources. HOD navigation and department-level fee/complaint views were checked against the HOD-specific API paths. No additional confirmed authorization-to-UI mismatch was found in this pass.

The schedule weekly table and day controls were checked against the Monday–Friday timetable data. The earlier suspected Friday-filter omission was not present in source logic; the day list is generated from the complete weekday array.

## Browser verification

The stale-token login screen was reloaded after the fix and no longer displayed the duplicate error notifications. The student dashboard showed the corrected paid-fee message **No outstanding balance**. Browser console inspection showed no runtime errors during the tested journeys.

## Automated verification

All **18/18 test suites passed**, including the new `assignment-date.test.js` regression suite. The dependency audit reported **zero vulnerabilities**. Server syntax validation passed. The production Vite build passed successfully. Vite continues to report only the existing non-functional large-chunk warning for the approximately 879 kB main JavaScript bundle.

## Conclusion

The additional user-visible date, status, deadline, authentication-transition, and timetable-boundary defects identified in this pass are fixed and regression-tested. No further confirmed user-facing logic defect was found within the audited role journeys and frontend/API contracts.
