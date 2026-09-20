# Phase 4 — Final-Year Project Submission

Server-side only (no client UI in this pass — see "Not done" below). New,
self-contained collection (`db.projects`); touches no exam, result, or fee
collection anywhere.

## New files

- `server/services/projectService.js` — status/type/grade constants, the
  status state machine guards, server-side team validation, access checks,
  and blob cleanup helpers.
- `server/routes/projects.js` — the router, mounted at `/api/projects` in
  `server/index.js`.
- `tests/project-workflow.test.js` — end-to-end flow + exit-gate checks.

## Changed files

- `server/services/uploadValidation.js` — added `PROJECT_UPLOAD_TYPES`
  (PDF, DOCX, PNG, JPEG), its own opt-in allow-list like
  `LIBRARY_UPLOAD_TYPES`, so this doesn't widen what notes/submissions/
  photos accept.
- `server/index.js` — imports and mounts `projectsRouter`.
- `package.json` — `test` script now also runs
  `tests/project-workflow.test.js`.
- `.env.example` — documented `PROJECT_UPLOAD_DIR` / `PROJECT_MAX_BYTES`
  (deliberately a separate env var from the shared `UPLOAD_DIR`, so this
  can never collide on disk with faculty-notes or assignment submissions
  if an operator sets one of those).

## Data model

```
project = {
  id, title, description, type: "individual" | "team",
  department, className,             // copied from the leader at creation
  leaderId, memberIds: [studentId],  // memberIds excludes the leader
  guideId,                           // always a teacher id
  status: "pending_guide" | "active" | "submitted" | "completed" | "rejected",
  milestones: [{
    id, title, description, dueDate,
    status: "pending" | "submitted" | "approved" | "rejected",
    submission: null | { name, type, size, uploadedBy, uploadedAt },  // storedName kept server-side only
    submittedAt, reviewedAt, reviewedBy, remarks
  }],
  finalSubmission: null | { name, type, size, uploadedBy, uploadedAt },
  finalGrade: null | "A+".."F",
  remarks, createdAt, updatedAt, completedAt
}
```

## Status workflow

Every transition is its own endpoint — there is no generic "PATCH status"
field a client could set directly, so an invalid jump has no code path that
accepts it:

```
pending_guide --(guide accepts)--------------> active
pending_guide --(guide declines)-------------> rejected
rejected      --(leader re-proposes a guide)-> pending_guide
active        --(all milestones approved,
                 leader/member submits final)-> submitted
submitted     --(guide approves + grade)------> completed
submitted     --(guide requests revision)-----> active
```

Admin can force-assign/reassign a guide at any point short of `completed`
(`POST /:id/guide/assign`), which auto-activates the project — useful when
a proposed guide is unavailable.

## Endpoints (`/api/projects`)

| Method & path | Who | Notes |
|---|---|---|
| `GET /guides` | any authenticated | id/name/department only, for guide pickers |
| `GET /me` | student | the caller's own project (leader or member), or `null` |
| `POST /` | student | creates project; requires `guideId` up front, status starts `pending_guide` |
| `PUT /:id` | leader | title/description only, blocked once `completed` |
| `PUT /:id/members` | leader | only while `pending_guide` |
| `PUT /:id/admin/members` | admin | same validation, no status restriction (short of `completed`) |
| `POST /:id/propose-guide` | leader | only from `pending_guide`/`rejected` |
| `POST /:id/guide/respond` | the proposed guide | `accept`/`decline`, only from `pending_guide` |
| `POST /:id/guide/assign` | admin | force-assign + auto-activate |
| `POST /:id/milestones` | guide or admin | only while `active` |
| `PUT /:id/milestones/:mid` | guide or admin | only while milestone is `pending`/`rejected` |
| `DELETE /:id/milestones/:mid` | guide or admin | cleans up any attached blob |
| `POST /:id/milestones/:mid/submission` | any team member | multipart; only while project `active` and milestone `pending`/`rejected` |
| `GET /:id/milestones/:mid/file` | member, guide, or admin | 403 for anyone else |
| `POST /:id/milestones/:mid/review` | guide or admin | `approve`/`reject`, only from `submitted` |
| `POST /:id/final-submission` | any team member | multipart; blocked unless every milestone is `approved` |
| `GET /:id/final-submission/file` | member, guide, or admin | 403 for anyone else |
| `POST /:id/review` | guide or admin | `approve` (requires enum `grade`) / `revise`, only from `submitted` |
| `GET /guide/mine` | teacher | projects where the caller is guide |
| `GET /` | admin | all projects, filterable by `status`/`department`/`guideId` |
| `GET /:id` | member, guide, or admin | 403 for anyone else |
| `DELETE /:id` | admin | deletes record + every stored blob (milestones + final) |

## Exit-gate checklist

- **Unauthorized users cannot access project documents** — every download
  route (`.../milestones/:mid/file`, `.../final-submission/file`) and every
  `GET /:id` runs through `canViewProject`: admin, the project's own guide,
  or a project member. Everyone else gets 403. Covered by
  `tests/project-workflow.test.js` (an outside student is denied on both
  the metadata route and the file route).
- **Invalid status changes are rejected** — no generic status setter
  exists; each transition endpoint asserts the current status/milestone
  status before acting (`assertProjectStatus`/`assertMilestoneStatus`,
  409 on mismatch). Tested: adding a milestone before guide acceptance,
  double-accepting, double-approving a milestone, submitting a final report
  with an unapproved milestone outstanding, editing/reassigning a completed
  project.
- **Failed uploads do not leave orphan blobs** — file-signature validation
  happens in `parseUpload` *before* any blob is written, so a rejected file
  is never saved. On the DB-write side, milestone/final submission and
  project creation all `saveFile` first and `deleteFile` in a `catch` if
  the following `writeDb` throws (mirrors `photos.js`/`library.js`).
  Deleting a milestone, deleting a whole project, or resubmitting over a
  rejected milestone all delete the now-unreferenced blob(s) after the DB
  record change lands. Tested: a `.txt` upload is rejected and the upload
  directory's contents are asserted unchanged; admin-deleting a project
  with a milestone submission + a final submission empties the upload
  directory.
- **Works with no exam or payment records** — `db.projects` is a new,
  independent top-level collection; nothing in `projectService.js` or
  `routes/projects.js` reads or writes `db.examinations`, `db.results`,
  `db.studentFees`, or `db.programFeeStructures`. Team/guide identities are
  looked up directly against the existing `db.students`/`db.teachers`.
  Tested: the full create → accept → milestone → final → grade → delete
  flow runs against the seed data, then the test asserts all three
  collections are still empty.

## Server-side-controlled team membership & guide assignment

- **Team membership** (`validateTeamMembers`): every member ID must
  resolve to a real student, in the *same class* as the leader, and not
  already leading/belonging to another in-progress project (only
  `completed` frees a student up — `rejected` is still "their" project,
  since they can re-propose a guide and keep going). Size is bounded
  2–5 including the leader. This runs identically whether the leader edits
  it (`pending_guide` only) or admin does (`PUT /:id/admin/members`, no
  status restriction).
- **Guide assignment**: a student can only *propose* a guide (existing
  teacher id, validated server-side) — the project doesn't become `active`
  until that specific teacher calls `/guide/respond` with `accept`, or an
  admin force-assigns via `/guide/assign`. A student can never set their
  own project to `active`.

## Assumptions made (flag if you want these different)

- **Grade scale**: fixed enum `A+, A, B+, B, C+, C, D, F` rather than a
  free-text or numeric field, so a guide can't accidentally record a grade
  that isn't a real value. Change `PROJECT_GRADES` in `projectService.js`
  if your institution uses a different scale.
- **Team size**: 2–5 including the leader (`MIN_TEAM_SIZE`/
  `MAX_TEAM_SIZE` in `projectService.js`). Easy to tune.
- **"Same class" rule for teammates**: I required all team members share
  the leader's `className`, since that's the only cohort signal
  `db.students` records. If your final-year teams can cross sections
  (same department, different class), relax this check.
- **One in-progress project per student**: a student can't start a second
  project while one is `pending_guide`/`active`/`submitted`/`rejected`.
  Only `completed` (or an admin delete) frees them up. Flag if a student
  should be able to abandon a rejected/stalled project and start fresh
  without admin involvement — I'd add a leader-initiated
  "withdraw"/"cancel" transition if so.
- **Milestones are guide-authored, not student-authored**: the team can
  only *submit against* milestones the guide (or admin) created — matches
  how supervision typically works, but flag if students should be able to
  propose their own milestones for guide approval instead/also.
- **File types**: PDF/DOCX/PNG/JPEG for both milestone and final-report
  uploads (`PROJECT_UPLOAD_TYPES`). No ZIP/code-archive support — flag if
  teams need to submit source-code bundles, since that'd need its own
  allow-list entry and a size-limit conversation.

## Not done (out of scope for this pass, flag if wanted)

- **No client UI.** This phase is server-only, per the request's framing
  ("Add ... guide assignment, milestones, ..." reads as an API-level ask,
  and every other phase's client pages are a separate, larger unit of
  work). Happy to build the student/guide/admin screens as a follow-up in
  the same style as `ProfilePhotoPanel.jsx`/`AppLayout.jsx`.
- **Audit-log entries** for project actions ride on the existing generic
  `POST/PUT/PATCH/DELETE` request logger in `server/index.js` (method +
  path + status), same as every other router — no project-specific audit
  detail (e.g. "grade changed from X to Y") beyond that.

## Verification status

I extracted your zip, added these files, and cross-checked every
import/export by hand (`node --check` on all four touched/added server
files, plus a script diffing each router's imports against the target
module's actual exports — all clean). **I could not run `npm install` or
`npm test`** in this environment — the sandbox has no network egress
(`npm install` fails with a 403 from the registry) and no pre-existing
`node_modules`, so nothing that imports `express`/`multer`/etc. can
actually execute here. `tests/project-workflow.test.js` is written and
wired into the `test` script, but **please run `npm install && npm test`
on your end** before trusting this beyond a static read-through.
