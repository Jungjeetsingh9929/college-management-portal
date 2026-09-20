# Role-Based End-to-End Audit

## Scope and method

The portal was tested as a real user in the sandbox browser using seeded **Student**, **Faculty**, and **Admin** accounts. The audit covered login, role-based redirects, navigation, live QR question sessions, attendance session controls, question submission, security monitoring, and visible error states. Backend regression tests and the production build were also rerun after the browser findings were corrected.

## Results by role

| Role | Journey | Result | Notes |
|---|---|---|---|
| Student | Login and dashboard | Passed | Dashboard loaded with attendance, classes, assignments, notices, record status, and navigation. |
| Student | Assignments page | Passed | Direct navigation and empty-state rendering worked. |
| Student | Logged-out QR deep link | Passed after fix | Deep link redirected to login with `returnTo`; successful login returned to the exact live session. |
| Student | Open live question | Passed | Question, options, protected correct answer, and submit controls rendered correctly. |
| Student | Answer submission | Improved | Browser geolocation could remain indefinitely in a waiting state; a hard client timeout was added with actionable feedback. Actual geofence submission could not be approved in the browser sandbox without a real campus location. |
| Faculty | Login and dashboard | Passed | Explicit Faculty role selection led to the faculty dashboard and class-scoped data. |
| Faculty | Start live QR session | Passed | Class, subject, title, duration, session creation, live state, and QR image rendered correctly. |
| Faculty | Add question | Passed | Four answer choices, correct-answer selection, protected answer display, and question persistence worked. |
| Faculty | Student-session access control | Passed | Faculty was redirected away from the student-only session route. |
| Admin | Login and dashboard | Passed | Admin dashboard loaded totals, activity, security alerts, students, and management navigation. |
| Admin | Security center | Passed | Filters, audit counts, audit history, and failed-login evidence loaded. |
| Admin | Attendance command center | Passed | Start session, live session card, rotating token, intervention area, and export control rendered. |
| Admin | Rotate QR token | Passed | The token changed while the active session remained live. |

## Issues found and fixed

### High severity: browser login blocked by development CORS

The first browser login attempt failed with “Something went wrong on the server.” The API log showed `Origin is not allowed by CORS`. API smoke tests did not expose this because they did not reproduce the Vite browser proxy origin. The server now allows local development proxy origins while retaining strict configured-origin behavior for production deployments.

### Medium severity: geolocation submission could hang indefinitely

The student answer page remained on “Checking your location...” in the browser sandbox. The browser permission/geolocation callback did not return promptly, leaving the submit button permanently disabled. A 20-second client-side fallback timeout now returns a clear instruction to allow location access and retry.

## Prioritized improvement recommendations

| Priority | Recommendation | Reason |
|---|---|---|
| P0 | Keep `NODE_ENV=production` and an explicit `CLIENT_ORIGIN`/`FRONTEND_URL` in every production deployment. | The development CORS fallback must never be used as a production configuration. |
| P1 | Add browser automation to CI using Playwright or TestSprite-style journeys for all three roles. | The CORS and geolocation issues were invisible to API-only tests. |
| P1 | Add a browser permission test matrix for location allowed, denied, unavailable, and timeout states. | Attendance depends on geolocation and needs deterministic user feedback. |
| P1 | Add a searchable subject/class selector to the attendance command center. | The current select contains a very large number of options and is difficult to operate in a real classroom. |
| P1 | Add a visible “Refresh questions/session” action on the student live-session page. | Students currently need a manual page refresh if faculty adds a question after they open the session. |
| P2 | Replace external QR image generation with a local QR library or server-generated asset. | This removes third-party availability/privacy dependency and avoids CSP/network surprises. |
| P2 | Add explicit success/error toasts for every mutation and disable duplicate submits during requests. | This creates consistent feedback across assignment, attendance, notices, and administrative actions. |
| P2 | Add visual regression checks at desktop and mobile widths. | The app is responsive, but the audit found several dense operational screens where mobile usability should be checked deliberately. |
| P3 | Split the large frontend bundle using route-level dynamic imports. | Vite reports a bundle over 500 kB; this is not a functional failure but will affect initial load time. |

## Final status

The tested critical journeys are operational after the two fixes above. The remaining recommendations are usability, deployment-hardening, test-coverage, and performance improvements rather than observed blockers in the audited flows.

## Second deep pass

A second pass covered role-boundary access, anonymous access, invalid coordinates, missing location, out-of-geofence submissions, valid submissions, duplicate answer replay, session closure, closed-session access, protected correct-answer data, and browser console output. All assertions passed and the browser console contained no runtime errors beyond the standard React DevTools informational message.

The development CORS fallback was tightened so it activates only when `NODE_ENV` is explicitly `development` or `test`. The package `server` script now sets `NODE_ENV=development`, which preserves local Vite-proxy usability without making an unset environment permissive. Production startup correctly requires `DATABASE_URL`; a production CORS smoke check cannot start without that deployment dependency, so production deployment validation must be run with the real PostgreSQL configuration.

The student geolocation timeout fix from the first audit remains in place and the build passes after the change.
