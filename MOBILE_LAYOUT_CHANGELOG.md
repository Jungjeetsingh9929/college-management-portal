# Mobile layout fixes (round 14)

Static fixes from a 375px audit. Not browser-verified in this build (see "Verify" below).

## Fixed
1. Sideways page scroll: `.page-stack` and the `.two-column` / `.wide-left` / `.profile-grid` rules now use `minmax(0, 1fr)`, and their children get `min-width: 0`, so a wide table can no longer stretch every section.
2. Wide tables: `.table-wrap`, `.schedule-table-wrap` and `.table-responsive` scroll horizontally inside their own box. Year Schedule now uses `table-wrap`.
3. Top bar: one row (menu button, name, actions) at <= 820px, overriding the old <= 640px column rule.
4. Drawer: no box-shadow or focus while closed, scrolls when taller than the screen, `100dvh`, single-column nav, closes on route change and Escape.
5. Section-heading icons stay beside the title.
6. Inputs are 16px on mobile (no iOS zoom on focus); buttons, nav links and icon buttons are at least 44px tall.

## Files
- `client/src/styles.css`: one block at the end, marked "MOBILE LAYOUT FIXES (round 14)".
- `client/src/components/AppLayout.jsx`: drawer closes on route change and Escape.
- `client/src/pages/YearSchedule.jsx`: table wrapper class.

## Not done
- Mobile search button (global search is still hidden below 820px).

## Verify
Run `npm install && npm run dev`, open DevTools at 375px and check: /student, /schedule, /admin, /marks, /reports, /fees, /history, /my-results, /faculty, /central-timetable, /subjects, /admin/security, /year-schedule. No page should scroll sideways; tables scroll inside their cards; admin drawer scrolls to Sign out.
