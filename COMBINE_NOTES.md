# Combine notes — 4 archives → 1 tree

## What was uploaded
- `college-management-portal-combined.zip` — phase 1 (profile enhancement) + phase 4 (final-year projects)
- `college-portal-phase1-profile-enhancement.zip` — phase 1 (profile enhancement)
- `college-portal-phase2-marks-cgpa.zip` — marks, grades, SGPA/CGPA
- `college-portal-phase7-payments.zip` — Razorpay fee payments, receipts

## What they actually were
Not four independent projects. Three feature branches that all grew from the
same Phase 1 tree, plus one archive that is already a subset of the result:

| Archive | Built on | Adds |
|---|---|---|
| phase1-profile-enhancement | (base) | bio, skills, links, emergency contact |
| college-management-portal-combined | phase 1 | phase 4 final-year projects (server only) |
| phase7-payments | phase 1 | online fee payments, ledger, PDF receipts |
| phase2-marks-cgpa | **the tree *before* phase 1's profile enhancement** | marks, grades, SGPA/CGPA |

The phase-2 archive was the tricky one: it has no `profileValidation` files, its
`StudentProfile.jsx`/`AuthContext.jsx`/`students.js` are the *older* versions, and
its `api.test.js` lacks the Phase 1 block. A naive overlay would have silently
reverted the profile enhancement.

## How the merge was built
Base = `college-portal-phase1-profile-enhancement` (so profile work is the
starting point, never overwritten). Then, per archive:

- **Files that exist in only one archive** were copied in as-is (all new
  routes, services, pages, tests, changelogs).
- **Files changed by only one archive** took that archive's version after
  diffing against phase 1 to confirm the delta was purely that feature.
- **Files changed by more than one archive** were three-way merged with
  `git merge-file`, ancestor = the phase 1 file (valid because the profile
  enhancement never touched them): `server/index.js`, `AppLayout.jsx`,
  `main.jsx`, `.env.example`. One textual conflict (`server/index.js`, the
  marks and projects import/mount lines landing on adjacent lines) was resolved
  by keeping both.
- **Hand-merged, because phase 2 predates the profile work:**
  - `client/src/styles.css` — phase 1 profile block + payments additions +
    marks block, each verified to be a pure append.
  - `server/routes/students.js` — phase 1 version (profile GET/PUT) plus the
    one line phase 2 added (delete a student ⇒ delete their `db.results`).
  - `package.json` — one `test` script running every phase's tests (deps were
    identical in all four).
  - `StudentProfile.jsx`, `AuthContext.jsx`, `tests/api.test.js` — phase 1 / 7
    versions (phase 2 had made no marks-related change to them).

## Resulting feature set
Phase 1 profile enhancement · Phase 2 marks/grades/CGPA (`/api/marks`) ·
Phase 4 final-year projects (`/api/projects`) · Phase 7 payments
(`/api/payments`, `/api/admin/payments`, webhook).
Changelogs for each are kept at the repo root.

## Verification performed
- `node --check` on all 60 `.js` files under `server/` and `tests/` — 0 failures.
- Every relative import in `server/`, `tests/` and `client/src/` resolves (323
  checked) and every named/default import matches a real export — 0 problems.
- No conflict markers left anywhere in the tree.
- Every file from all four archives is present in the result (or is a
  deliberate merge of several versions — listed above).

**Not run:** `npm install`, `npm test`, `vite build`. This environment has no
network egress, so `express`, `vite` etc. can't be installed and nothing that
imports them could execute. Please run `npm install && npm test && npm run build`
on your side before relying on it.

### Known issue carried over (not introduced by the merge)
`tests/api.test.js` line ~74 assumes the first fee structure's department has
a seeded student; the first is now "Administration", which has none. The
phase-2 changelog reports it failing on the original archive. Because of that,
`npm test` orders the new-feature tests (marks, payments, projects) **before**
`api.test.js` so they still run; `quiz-session` and `regression-flow` come
after it and won't run until that one-line lookup is fixed.

---

# Earlier combine (kept for history)

# Combine notes — 5 archives → 1 tree

## What was uploaded
- `college-management-portal-app-ready__4_.zip`
- `college-management-portal-app-ready__4__copy.zip`
- `college-portal-phase1-profile-enhancement.zip`
- `college-portal-phase1-profile-enhancement_copy.zip`
- `phase4-final-year-project.zip`

## What they actually were
Not five independent things — three, once duplicates are removed, and those
three are **linear**, not divergent:

- `..._copy.zip` files are byte-for-byte identical to their non-`_copy`
  counterparts (`diff -rq` found zero differences). Dropped both.
- `college-portal-phase1-profile-enhancement.zip` is `app-ready__4_.zip`
  plus profile photos, the digital library, events calendar, and photo
  approvals (confirmed by diffing the two full trees — every file only in
  `app-ready` was cosmetic: `.gitignore` and two unused maskable-icon PNGs
  that phase1's manifest stopped referencing).
- `phase4-final-year-project.zip` is not a full project tree — it's an
  8-file delta (its own changelog says so) containing only the files it
  added or touched. Diffing its `server/index.js` against phase1's showed
  the *only* difference was the new `projectsRouter` import/mount; every
  route phase1 had mounted was already present unchanged. That confirms it
  was built on top of phase1, not app-ready.

## How the merge was built
Base = `college-portal-phase1-profile-enhancement` (the superset). Applied
on top, from `phase4-final-year-project`:

- New files copied in as-is: `server/routes/projects.js`,
  `server/services/projectService.js`, `tests/project-workflow.test.js`,
  `PHASE_4_CHANGELOG.md`.
- Changed files replaced wholesale after diffing to confirm the only delta
  was the phase-4 addition (no phase1 content was dropped in any of these):
  `server/index.js`, `server/services/uploadValidation.js`, `package.json`,
  `.env.example`.
- Restored `.gitignore` from `app-ready` (phase1 had dropped it; harmless
  to bring back, useful to keep).

## Verification performed
- Every relative import in the tree resolves to a real file (0 unresolved).
- Every named import matches an actual export in the target module (0
  missing).
- All server/test `.js` files parse under `node --check`.
- Traced every route in `projects.js` that touches `db.projects` and
  confirmed each calls `ensureProjectCollections(db)` first (the one
  exception, `GET /guides`, never touches `db.projects` at all — it only
  reads `db.teachers`).
- No filename collisions outside of expected same-named files in different
  folders (`middleware/auth.js` vs `routes/auth.js`, etc).

`npm install && npm test` still needs to run on your end — this
environment has no network egress, so nothing that imports `express` /
`multer` / etc. can actually execute here.
