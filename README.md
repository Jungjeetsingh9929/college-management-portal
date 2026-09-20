# College Management Portal

A full-stack college management web application built with React, Node.js, and Express.

The project focuses on common college operations such as role-based access, student approval, attendance tracking, timetable management, complaints, teacher records, and report generation. It is designed as a portfolio project to demonstrate full-stack development, REST API structure, responsive UI, and deployment readiness.

## What It Shows

- React dashboard UI for admin and student workflows
- Node.js and Express backend with protected routes
- Role-based authentication structure
- Student request and approval flow
- Attendance management with duplicate-entry protection
- Staff-marked attendance — a teacher (for their own classes) or an admin (for any class) marks each student present or absent from a roster
- Geofenced quiz-based attendance — a teacher posts a short quiz question, and a student who answers correctly (from a device physically on campus) is automatically marked present, no staff action needed
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
| Storage | PostgreSQL when `DATABASE_URL` is set; local JSON fallback for development |
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
server. `JWT_SECRET` must be at least 32 characters. Configure each faculty
account through `FACULTY_<CODE>_EMAIL` and `FACULTY_<CODE>_PASSWORD`; never rely
on predictable demo passwords in a shared or production environment.

### Geofenced quiz attendance

Set `COLLEGE_LATITUDE`, `COLLEGE_LONGITUDE`, and `COLLEGE_RADIUS_METERS` in
`.env` to your campus's coordinates. Once set, a student answering a
teacher's attendance quiz is only marked present if their browser's GPS
location is within `COLLEGE_RADIUS_METERS` of the college; the server
rejects the answer otherwise. Everything else in the app (viewing
schedules, assignments, quizzes, reports, etc.) works from anywhere in the
country — only the quiz-answer submission is location-restricted. If these
variables are left unset, the quiz-answer endpoint responds with a 503
instead of marking attendance.

Students can no longer mark themselves present directly. Attendance is
recorded in exactly two ways: a teacher or admin marking a student by hand
from the "Mark Attendance" roster, or a student answering a quiz question
correctly while on campus.

Notes:
- Geolocation requires HTTPS in production browsers (or `localhost` while
  developing) — a plain `http://` deployment will not be able to prompt for
  location.
- This is a reasonable deterrent against a student answering a quiz from
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

The server now rejects weak JWT secrets, requires `DATABASE_URL` in production,
limits login and quiz-answer attempts, scopes teacher attendance to their
scheduled classes, uses parameterized PostgreSQL state queries in production,
and defuses spreadsheet formulas in CSV exports. If secrets were
ever committed to a public repository, rotate them and scrub the repository
history separately; deleting the files in a new commit is not enough.

## Portfolio Notes

When `DATABASE_URL` is set, the server stores its application state in a PostgreSQL table and automatically initializes the table on first start. Local JSON storage remains available only for development and tests; production startup fails if `DATABASE_URL` is missing. Render should provide `DATABASE_URL`, `JWT_SECRET`, `FRONTEND_URL`/`CLIENT_ORIGIN`, token settings, and upload-storage settings through its environment configuration. Uploaded files use isolated runtime storage; durable production retention requires object storage or a persistent disk.

This project is best viewed as a full-stack learning and portfolio project, not a production-ready college system.
