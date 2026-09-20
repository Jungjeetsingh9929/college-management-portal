# Phase 2, Module 1 — Marks, Grades & CGPA

Teachers enter internal + end-semester marks per subject; the server turns them
into grades on a 10-point scale, publishes them to students, and computes SGPA
per semester and CGPA overall. Results move **draft → published → locked**, one
way, with an admin-only, audited "unlock" as the single way back.

## Design decisions (please review — the first two are assumptions I made)

- **Grade thresholds (assumption).** You chose the 10-point O/A+/A/B+/B/C/P/F
  scale but not the percentage bands. I used:
  O ≥ 90 → 10, A+ ≥ 80 → 9, A ≥ 70 → 8, B+ ≥ 60 → 7, B ≥ 50 → 6, C ≥ 45 → 5,
  P ≥ 40 → 4, F < 40 → 0. **Pass = grade P or better (total ≥ 40 %).** There is
  no separate minimum for end-sem alone. If your university's regulations differ,
  change `GRADE_SCALE` in `server/services/marksService.js` (one place; the
  student page, the API and the tests' boundary cases all follow it — the tests
  will tell you which boundaries moved).
- **Absent.** A teacher can tick *Absent* (end-semester exam only). The student
  gets grade F / 0 points regardless of internal marks, shown as "F (AB)", and
  still counts in SGPA/CGPA.
- **Who may enter marks.** Whoever's teacher code appears as a **whole code** in
  the subject's `teacher` text (`AGA`, `AYV, LRG`, `DCE/SSR/SYN`,
  `DCE :: AGA(LAB-2)` all work). Admin can enter too. I deliberately do **not**
  also require the class to appear in the teacher's timetable: the existing
  timetable parser can't read annotated codes like `AGA(LAB-2)`, which would lock
  lab teachers out.
- **Roles.** Teacher publishes; **HOD or admin locks**; **only admin unlocks**
  (reason 5–300 chars, stored on the sheet and in the audit log).
  Unlocking **withdraws the results from students** until re-published, and the
  re-publish regenerates the snapshot.
- **HOD oversight.** An HOD can view (read-only) and lock any subject whose
  `department` equals theirs, or whose class contains a student of their
  department (subjects have no department today, so this goes through students,
  as you noted). If a class mixes departments, each department's HOD oversees it.
- **Snapshots.** Publishing writes one `db.results` row per student with the
  subject name, code, credits, semester, maximums, marks, grade and points copied
  in. Later subject edits can't change a transcript.
- **Non-credit subjects** (credits = 0, e.g. Mentoring) can be given marks and
  grades but are listed as "not counted in GPA". A subject with **no** credits or
  semester set can't be published (the sheet says why).
- **CGPA includes failed subjects** (F = 0 points) and there is no
  re-attempt/supplementary model — a retake would be a separate subject record.
  Say so if you want that next.
- **Subject freezing.** While a sheet is published/locked, its subject's class,
  code, semester and credits can't be edited and the subject can't be deleted
  (409, "unlock first"). Changing a subject's class once marks exist is also
  blocked. Draft sheets and subjects without marks are unaffected.
- **Roster.** The students in a subject's class who are approved and not
  deactivated. Results are created only for students on the roster at publish.

## What's new

### Server
- `server/services/marksService.js` — grade scale, grade/outcome maths, SGPA/CGPA,
  input parsers, roster and access rules. No I/O; unit-tested.
- `server/routes/marks.js` (`/api/marks`, mounted in `server/index.js`):
  | Route | Who |
  |---|---|
  | `GET /grade-scale` | any signed-in user |
  | `GET /subjects?className&semester&status&q` | admin: all · teacher: own subjects + HOD department |
  | `GET /sheet/:subjectId` | subject teacher, admin, overseeing HOD (read-only) |
  | `PUT /sheet/:subjectId` (maximums + many rows, all-or-nothing) | subject teacher, admin; draft only |
  | `POST /sheet/:subjectId/publish` | subject teacher, admin; needs every row complete |
  | `POST /sheet/:subjectId/lock` | admin, overseeing HOD; published only |
  | `POST /sheet/:subjectId/unlock` `{reason}` | admin only |
  | `GET /sheet/:subjectId/export.csv` | same as view |
  | `GET /me` | student (own results only) |
  | `GET /students/:studentId` | admin; HOD for own department |
  | `GET /export.csv?view=results\|summary&className&semester&subjectId` | admin; HOD scoped to department (summary needs `semester`) |
- **Data (all lazy, no migration):** `db.markSheets` (new: status, maximums,
  history), `db.internalMarks` (extended: `endSemMarks`, `absent`, `updatedBy`;
  `marks`/`maxMarks` keep meaning *internal*), `db.results` (was read-only; now
  the published snapshot).
- `server/routes/subjects.js` — `credits` (0–20, steps of 0.5, blank = not set)
  and a validated `semester` (1–12; an already-stored legacy value is accepted
  unchanged) on create/edit; freezing/delete rules above; deleting a subject also
  removes its sheet.
- `server/routes/students.js` — deleting a student also deletes their results.
- `server/routes/shared.js` — student portal `academics` is now computed (latest
  semester SGPA, CGPA, subject grades); the existing "Result published" bell
  notification now links to `/my-results` (newest first).
- `server/routes/admin.js` — `examinationStats.publishedResults` now counts
  published/locked sheets instead of raw result rows (no UI reads it today).
- **Audit:** `marks.publish`, `marks.lock`, `marks.unlock` are written to the
  audit log in the same DB write as the change (unlock is severity `warning` and
  carries the reason), on top of the global per-request audit.
- **CSV:** reuses the existing `csvEscape` (formula-injection safe).

### Bug fixes made along the way
- `teacherScope()` in `faculty.js` matched teacher codes by **substring**, so
  teacher `A` counted as teaching every subject whose teacher text contained an
  "a" (141 of the 404 seeded subjects; teacher `N`: 76). It now matches whole
  codes. This narrows `/faculty/portal` and `/faculty/marks` to the right subjects.
- `PUT /faculty/marks` (the old single-mark writer) is **retired → 410**. Two
  writers on `db.internalMarks` could have edited rows on a published sheet.
  `GET /faculty/marks` and `/faculty/portal` still work.

### Client
- `pages/MarksCenter.jsx` (`/marks`, admin + teacher/HOD): status counts, filters,
  subject table, HOD/admin CSV export (subject-wise results, SGPA/CGPA summary).
- `pages/MarksSheet.jsx` (`/marks/:subjectId`): editable grid with live grade
  preview, absent tick, save draft, publish, lock, unlock-with-reason, CSV,
  history. Read-only once published.
- `pages/MyResults.jsx` (`/my-results`, student): CGPA, SGPA, credits, per-semester
  tables, grade scale.
- `SubjectManagement.jsx` — semester dropdown + credits field; table shows both.
- `StudentDashboard.jsx` — Performance panel shows SGPA/CGPA/grades + link.
- `FacultyTools.jsx` — the old mark form/list is replaced by a link to Marks &
  Results (nav entry renamed "Notes & Notices"; new "Marks & Results" entry).
- `components/MarksBadges.jsx`, `AppLayout.jsx`, `main.jsx`, `styles.css` (a small
  `marks-*` block plus badge colours).

## Verification (what was actually run)

This sandbox **did** have npm access, so unlike earlier phases I ran `npm ci` and
tested against the real stack.
- `node --check` on every file under `server/` and `tests/` — pass.
- esbuild bundle of the whole client from `main.jsx`, and a real `vite build` — pass.
- `tests/marks-service.test.js` (new, dependency-free): every grade boundary,
  absent/zero-max edge cases, SGPA/CGPA maths (weighting, non-credit exclusion,
  failed credits), parsers, whole-code teacher matching, full permission flags — pass.
- `tests/marks-api.test.js` (new): boots the real Express app and exercises ~180
  requests: permission matrix for admin / subject teacher / co-teacher /
  annotated-code lab teacher / unrelated teacher / substring-code teacher / HOD /
  other department's HOD / student / anonymous; invalid input (bad credits,
  semester, marks, maxima, duplicates, unknown or out-of-class students, oversize
  batches, unknown fields, all-or-nothing saves); one-way transitions (publish
  twice, edit after publish, lock twice, unlock a draft); GPA maths across two
  semesters incl. a non-credit subject; snapshot stability; unlock withdrawing
  results + audit entry; freeze/delete rules; CSV scoping; student/subject
  delete cleanup. Both files run in `npm test`.
- I **mutation-checked** the API test (substring teacher matching, HOD-can-unlock,
  publish ignoring missing rows, leaking internal fields): each made it fail.
- Headless-Chromium walk-through against the real API + Vite dev server:
  teacher enters marks → save → publish (read-only afterwards, no Lock/Unlock
  buttons) → student sees results and dashboard panel → admin locks and unlocks
  with a reason → student's results disappear. No console errors. I looked at
  screenshots and fixed two layout/colour problems they showed. **This browser
  script is ad-hoc and not shipped in the zip.**
- Existing suites: `client-origin`, `upload-validation`, `quiz-session`,
  `regression-flow` pass.

**Not verified:** Postgres mode (only the disk store was used); two teachers
saving the same sheet at the same moment (relies on the existing global write
lock); mobile layout; the HOD screens in a browser (HOD rules are covered through
the API only); opening the CSVs in Excel; behaviour on your real data.

### ⚠ Pre-existing failure — `npm test` still stops at `api.test.js`
`tests/api.test.js` line 74 asserts that the **first** fee structure's department
has a roster student; the first is now "Administration", which has none. It fails
identically on the zip you sent me, before any of my changes. I did not touch it.
I put the two marks tests **before** it in the `test` script so they still run.
To check my changes against the rest of that file, I ran a temporary copy with
that one lookup pointed at "Computer Science": everything after it passed (the
copy is not in the zip). Fixing it properly is a one-line change — say the word.

## Before you try it
1. `npm install && npm test` (expect the api.test.js failure above), `npm run dev`.
2. **All 404 seeded subjects have no semester or credits**, so every subject shows
   "No semester / No credits" and can't be published until you fill them in on the
   **Subjects** page. Nothing is guessed.
3. Subject teacher texts that aren't teacher codes (e.g. "Updated Faculty",
   "Prof. Kavita Iyer") match no account — only an admin can enter marks for those.

## Known limits / things I noticed but did not change
- `scheduleBelongsToTeacher`/`teacherCodes` (used by attendance) can't parse
  `AGA(LAB-2)` or `::`, so teachers who appear only with such annotations get no
  classes for attendance. Marks use a separate parser and are unaffected. Worth
  its own fix.
- `admin.js` faculty workload and `teachers.js` workload still use the substring
  match, so those counts are inflated.
- Deactivating a student after publish doesn't remove their results; deleting does.
- A student who joins a class after its sheet is published has no result until an
  admin unlocks and the teacher re-publishes.
- Teachers aren't notified when their sheet is unlocked (they see the status and
  the reason on the sheet).
- No student-facing CSV/PDF transcript yet (PDF export is planned for Phase 5).
- Still open from Phase 1: EXIF/GPS stripping (needs `sharp`), top-bar avatar
  photo, per-class Digital Library audience.

## Next (waiting for your review)
Phase 2, module 2 — Semester Feedback + analytics. I'll ask my (≤ 3) design
questions when you say go.
