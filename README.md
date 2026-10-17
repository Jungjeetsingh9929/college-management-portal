# College Management Portal

A web app for running the day-to-day side of a college: attendance, timetables, assignments, marks, fees, complaints and notices. It has separate views for admins, teachers (including heads of department) and students.

I built it with React on the front and Express on the back. It started as a small attendance project and grew from there, so some parts are newer and rougher than others.

## What's in it

**Students** can see their timetable and attendance, hand in assignments, check marks and CGPA, view and pay fees, update their profile, and raise complaints.

**Teachers** can mark attendance by hand or run a short quiz that students answer from campus. They can also set assignments, enter marks, upload notes and review project submissions.

**Admins and HODs** manage students, faculty, subjects, rooms and departments, approve profile photos, edit fee structures and download CSV/PDF reports.

Other bits: an events calendar, a digital library (uploaded files or links), a notice board, and an installable PWA shell.

## Stack

| | |
| --- | --- |
| Frontend | React 18, Vite, React Router, Recharts |
| Backend | Node.js, Express 5 |
| Auth | JWT access tokens plus refresh sessions, bcrypt |
| Storage | PostgreSQL if `DATABASE_URL` is set, otherwise a local JSON file |
| Payments | Razorpay (sandbox), optional |
| Reports | PDFKit and CSV |

## Running it locally

You need Node 20 or newer.

```bash
npm install
cp .env.example .env
```

Open `.env` and fill in the blanks. At minimum set `JWT_SECRET` (32+ random characters) and the seed passwords. Passwords need to meet the login policy, so use something long with upper and lower case, a number and a symbol.

Then start both halves in two terminals:

```bash
npm run server   # API on http://localhost:5055
npm run client   # app on http://localhost:5175
```

or just `npm run dev` to run them together.

The first start seeds a demo admin, some students and a set of faculty accounts with made-up names. Admin and student emails/passwords come from your `.env`. Faculty accounts get random passwords unless you set `FACULTY_<CODE>_EMAIL` and `FACULTY_<CODE>_PASSWORD`.

## Tests and build

```bash
npm test         # runs every file in tests/ separately
npm run build    # production build of the client into dist/
```

## Deploying

`render.yaml` is set up for Render. The build is `npm ci && npm run build` and the start command is `npm start`. Set the environment variables from `.env.example` in the dashboard. In production the server refuses to start if `DATABASE_URL`, `JWT_SECRET`, the seed passwords or the client origin are missing.

A few things worth knowing:

- Set `TRUST_PROXY` to match how many proxies sit in front of the app. If it's wrong, rate limiting can be dodged by spoofing `X-Forwarded-For`.
- Attendance quizzes only work if `COLLEGE_LATITUDE`, `COLLEGE_LONGITUDE` and `COLLEGE_RADIUS_METERS` are set. Browsers also need HTTPS to share location.
- Payments are off until the Razorpay keys are set. Fees still work without them.

## Folder layout

```text
client/   React pages, components and styles
server/   routes, services, middleware and the data layer
tests/    API and unit tests
docs/     API notes
```

## Notes

All names, emails and records in the seed data are made up. The JSON file store is fine for a demo but use Postgres for anything real.

Released under the MIT license, see `LICENSE`.
