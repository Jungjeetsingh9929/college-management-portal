# College Management Portal

A full-stack college management web application built with React, Node.js, and Express.

The project focuses on common college operations such as role-based access, student approval, attendance tracking, timetable management, complaints, teacher records, and report generation. It is designed as a portfolio project to demonstrate full-stack development, REST API structure, responsive UI, and deployment readiness.

## What It Shows

- React dashboard UI for admin and student workflows
- Node.js and Express backend with protected routes
- Role-based authentication structure
- Student request and approval flow
- Attendance management with duplicate-entry protection
- Geofenced student self check-in — the app is usable from anywhere, but a student can only mark themselves present when their device's GPS shows they're physically on campus
- Timetable, subject, teacher, and complaint modules
- CSV/PDF report generation
- Mobile-friendly frontend layout
- API structure designed around protected college workflows

## Tech Stack

| Area | Tools |
| --- | --- |
| Frontend | React, Vite, JavaScript, HTML, CSS |
| Backend | Node.js, Express.js |
| Auth | JWT, bcryptjs |
| Reports | PDFKit, CSV export |
| Storage | Local JSON storage for demo setup |
| Testing | Node.js API smoke tests |

## Project Structure

```text
client/     Frontend pages, components, styles, and context
server/     Backend routes, middleware, services, and data helpers
tests/      API smoke tests
docs/       Additional technical notes
```

## Local Setup

Install dependencies:

```bash
npm install
```

Create a local environment file:

```bash
cp .env.example .env
```

Replace every placeholder in `.env` with unique local values before starting the
server. `JWT_SECRET` must be at least 32 characters. Each seeded teacher gets
its own predictable demo login of the form `<code>@example.edu` /
`<CODE>@Uem2026` (e.g. `lrg@example.edu` / `LRG@Uem2026`) — see
`server/db/teacherLegend.js` for the full code list. To give an individual
faculty member a real login instead, set `FACULTY_<CODE>_EMAIL` and
`FACULTY_<CODE>_PASSWORD` in `.env`.

### Geofenced attendance

Set `COLLEGE_LATITUDE`, `COLLEGE_LONGITUDE`, and `COLLEGE_RADIUS_METERS` in
`.env` to your campus's coordinates. Once set, logged-in students see a
"Mark my attendance" card on their dashboard: tapping it asks the browser
for the device's GPS location, and the server only accepts the check-in if
that location is within `COLLEGE_RADIUS_METERS` of the college. Everything
else in the app (viewing schedules, assignments, quizzes, reports, etc.)
works from anywhere in the country — only the attendance check-in itself is
location-restricted. If these variables are left unset, the check-in card
is hidden and the feature is effectively disabled.

Notes:
- Geolocation requires HTTPS in production browsers (or `localhost` while
  developing) — a plain `http://` deployment will not be able to prompt for
  location.
- This is a reasonable deterrent against a student marking attendance from
  home, not a forgery-proof system — a browser extension or a rooted/jailbroken
  phone can still fake GPS coordinates. Treat it as one signal, not a
  guarantee, if you extend this into a real production attendance system.

Start the backend:

```bash
npm run server
```

Start the frontend in another terminal:

```bash
npm run client
```

Run tests:

```bash
npm test
```

Build the frontend:

```bash
npm run build
```

## Deployment

The project includes a production start script and can be deployed on a Node.js hosting platform such as Render, Railway, Fly.io, or a VPS.

For production use, configure secrets and runtime values through the hosting dashboard. Do not commit real environment values, student records, attendance data, contact data, device keys, or generated database files.

The server now rejects weak JWT secrets, limits login and quiz-answer attempts,
scopes teacher attendance to their scheduled classes, uses atomic serialized
JSON writes, and defuses spreadsheet formulas in CSV exports. If secrets were
ever committed to a public repository, rotate them and scrub the repository
history separately; deleting the files in a new commit is not enough.

## Portfolio Notes

This repository uses synthetic demo data and local JSON storage to keep setup simple. A production version should use a real database, stronger validation, audit logging, rate limiting, secure file storage, and proper privacy controls for any sensitive data.

This project is best viewed as a full-stack learning and portfolio project, not a production-ready college system.
