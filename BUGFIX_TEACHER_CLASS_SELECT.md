# Bugfix: Teacher couldn't select certain classes

## Report
A teacher reported that they could not select a class they teach (e.g. in
Assignments, Notices, Notes, Attendance session/quiz creation).

## Root cause
`server/services/accessService.js` — `teacherCodes()` is used everywhere a
teacher's schedule "teacher" field needs to be parsed into individual
codes, and `classesTaughtByTeacher()` (which powers every class dropdown
on the faculty side) depends on it.

The parser only split on `, / & and`. Real schedule data also uses:
- parenthetical lab/zone annotations, e.g. `"AGA(LAB-2)"`, `"SBE (LAB-5)"`,
  `"AKT(Zone 4)"`
- a `"::"` co-teaching separator, e.g. `"DCE :: AGA(LAB-2)"`

Neither of these was handled, so a schedule row like `"AGA(LAB-2)"` was
treated as one unmatched code (`"aga(lab-2)"`) instead of `"AGA"` — the
teacher was never credited with that class, and it silently disappeared
from their class-selection dropdown. `subjectTeacherCodes()` (used for
marks entry) already handled both cases correctly; `teacherCodes()` had
just never been updated to match.

### Confirmed real-world impact (audit of `server/db/database.json`)
Before the fix, these teachers were missing classes from every dropdown
that uses `classesTaughtByTeacher()`:
- **LRG** — missing `CSE 2B`
- **SBE** — missing `EE2`, `ECE2`
- **AKT** — missing `CSE3-A`, `AIML3-A`, `CSE3-B`

## Fix
`teacherCodes()` now strips `(...)` annotations before splitting, and
splits on `::` in addition to the existing delimiters — mirroring
`subjectTeacherCodes()`'s parsing exactly.

```js
// server/services/accessService.js
export function teacherCodes(value) {
  return String(value || "")
    .replace(/\([^)]*\)/g, " ")
    .split(/,|\/|&|::|\s+and\s+/i)
    .map((code) => code.trim().toLowerCase())
    .filter(Boolean);
}
```

This is used by `scheduleBelongsToTeacher()` and `classesTaughtByTeacher()`,
so the fix automatically applies everywhere those are used: Assignments,
Notices, Notes, Attendance question/session creation, and Quiz sessions
(all in `server/routes/faculty.js`), plus `studentIdsVisibleToTeacher()`.

## Test
Added `tests/access-service.test.js` — dependency-free unit tests covering:
- existing delimiters still parse correctly
- parenthetical annotations are stripped
- the `::` separator is split
- `classesTaughtByTeacher()` no longer drops annotated/combined classes,
  reproducing the exact `AKT`/`AGA`/`DCE` scenarios found in the real data

## Files changed
- `server/services/accessService.js` (fix)
- `tests/access-service.test.js` (new regression test)
