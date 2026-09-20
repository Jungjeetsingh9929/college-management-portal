# Phase 1, Module 1 — Events Calendar

New module. Follows the existing route → service pattern (no dedicated
controller layer, same as `fees.js`/`complaints.js`); reuses the existing
global audit-logging and rate-limiting middleware in `server/index.js`
rather than adding module-specific copies.

## What's new

- `server/routes/events.js` — `db.events` collection, mounted at
  `/api/events`.
  - `GET /` — role-scoped visibility. `audience: "all"` events are visible
    to everyone; a class-scoped event (`audience: "<className>"`) is
    visible to admins, the teacher who teaches that class, its students,
    and always to its creator. Supports `?category=` and (staff-only)
    `?mine=true` filters. Returns `categories` (the fixed enum) and
    `availableClasses` (all classes for admin, taught classes for a
    teacher) so the client can build its dropdowns without a second
    endpoint.
  - `POST /`, `PUT /:id`, `DELETE /:id` — staff only (`requireStaff`).
    Editing/deleting is further restricted to the event's creator or an
    admin. A teacher can only target `audience` at a class they actually
    teach (same rule `facultyRouter`'s notices already enforce) — an
    admin can target any class.
  - Categories: `Academic, Cultural, Sports, Workshop, Holiday, Exam,
    Other` (enum-validated server-side, matches `enumValue` convention).
  - Each event carries a computed `status` (`upcoming` / `ongoing` /
    `past`) derived from today's date — not stored, so it's always
    correct without a cron job.
- `client/src/pages/EventsCalendar.jsx` — stats row, staff-only
  publish/edit form, filterable list split into upcoming vs. a collapsed
  "past events" section.
- Nav entry + `/events` route for all three roles (admin, teacher,
  student) — it's a view-everyone / manage-staff module like Complaints,
  not role-gated the way Fees is.
- `styles.css` — added `.event-*` classes (mirroring the existing
  `.complaint-*` list/card pattern) and a few category-specific badge
  colors (`.badge.academic`, `.badge.cultural`, etc. — the generic badge
  fallback still covers anything not explicitly styled).

## Not in scope for this module

- No recurring events (each entry is a single date or date range).
- No file attachments on events (that's the Digital Library module,
  next up).
- No push/email notifications for new events — falls under the existing
  `NotificationCenter`/audit pattern if wanted later, but wasn't asked
  for.

## Verification performed in this sandbox

`node_modules` isn't installed here and this environment has no network
access, so the app couldn't actually be run end-to-end. What was checked
instead:

- `node --check` on every server file (this module's new file, the
  edited `index.js`, and every existing route/service/middleware file,
  to make sure nothing else was accidentally broken).
- Every named import in `events.js` (`readDb`, `writeDb`, `makeId`,
  `requireAuth`, `requireStaff`, `classesTaughtByTeacher`, `enumValue`,
  `requiredText`, `validateKeys`) was matched against the actual
  `export` statements in its source file.
- `esbuild` (bundler already vendored for another tool in this sandbox)
  used to parse+bundle `client/src/main.jsx` — the whole client app,
  every page included — with only third-party packages marked external.
  This confirms every import path, JSX syntax, and the new route/nav
  wiring resolves correctly.
- Confirmed `/api/events` doesn't collide with any existing mounted
  path.

Recommend running `npm install && npm test` and a manual click-through
(as admin, a teacher, and a student) on your end before merging, since
this sandbox couldn't do that final step.
