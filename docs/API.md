# API notes

The React client talks to a REST API under `/api`. Every route except login, registration and the payment webhook needs a bearer token, and each router checks the caller's role.

| Router | Covers |
| --- | --- |
| `auth` | login, refresh, sessions, password reset and change |
| `students`, `teachers` | profiles, approvals, rosters |
| `attendance` | manual marking, quiz check-in, corrections |
| `subjects`, `schedules` | subjects, timetable, rooms |
| `faculty`, `shared` | assignments, notes, submissions, notices |
| `marks` | components, grades, SGPA/CGPA, publishing |
| `projects` | final-year project milestones and reviews |
| `fees`, `payments` | fee structures, dues, Razorpay orders, webhook, receipts |
| `events`, `library`, `photos` | calendar, digital library, photo approval |
| `complaints`, `reports` | complaints and CSV/PDF exports |
| `admin`, `hod` | department and user management |

Read the route files in `server/routes/` for exact paths and payloads. Keep real keys, student data and generated database files out of the repo.
