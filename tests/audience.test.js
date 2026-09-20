// Dependency-free (no express/db boot), like client-origin.test.js.
// Covers server/services/audienceService.js, the Phase 8.4 addition that
// lets the Digital Library restrict an item to one class, opt-in and
// defaulting to "all" so pre-existing items and every caller that never
// sends the field keep seeing exactly what they did before.
import assert from "node:assert/strict";
import { applyAudience, audienceVisibleTo } from "../server/services/audienceService.js";

const db = {
  students: [
    { id: "s1", className: "CSE 3A" },
    { id: "s2", className: "CSE 3B" }
  ],
  schedules: [
    { teacher: "T01", section: "CSE 3A", day: "Mon", startTime: "09:00" }
  ]
};

const admin = { role: "admin", id: "a1" };
const teacherOfA = { role: "teacher", id: "t1", code: "T01" };
const teacherOfOther = { role: "teacher", id: "t2", code: "T99" };
const studentA = { role: "student", id: "s1" };
const studentB = { role: "student", id: "s2" };

// --- visibility: unscoped / "all" is unchanged for everyone -------------

assert.equal(audienceVisibleTo(undefined, studentA, db), true, "an item with no audience field (pre-existing data) stays visible");
assert.equal(audienceVisibleTo("all", studentA, db), true);
assert.equal(audienceVisibleTo("all", teacherOfOther, db), true);

// --- visibility: class-scoped item ---------------------------------------

assert.equal(audienceVisibleTo("CSE 3A", studentA, db), true, "student in the scoped class can see it");
assert.equal(audienceVisibleTo("CSE 3A", studentB, db), false, "student in a different class cannot");
assert.equal(audienceVisibleTo("CSE 3A", teacherOfA, db), true, "teacher who teaches that class can see it");
assert.equal(audienceVisibleTo("CSE 3A", teacherOfOther, db), false, "teacher who doesn't teach that class cannot");
assert.equal(audienceVisibleTo("CSE 3A", admin, db), true, "admin always sees everything");

// --- applyAudience: defaults and bounds ----------------------------------

let target = {};
assert.equal(applyAudience(target, undefined, db, admin), null);
assert.equal(target.audience, "all", "no audience supplied defaults to campus-wide");

target = {};
assert.equal(applyAudience(target, "", db, admin), null);
assert.equal(target.audience, "all", "blank audience also defaults to campus-wide");

target = {};
assert.equal(applyAudience(target, "  CSE 3A  ", db, admin), null);
assert.equal(target.audience, "CSE 3A", "trimmed, and an admin may scope to any class");

target = {};
assert.equal(applyAudience(target, "x".repeat(500), db, admin), null);
assert.equal(target.audience.length, 80, "audience value is bounded");

// --- applyAudience: a teacher may only scope to a class they teach ------

target = {};
assert.equal(applyAudience(target, "CSE 3A", db, teacherOfA), null, "teacher scoping to their own class succeeds");
assert.equal(target.audience, "CSE 3A");

target = {};
const error = applyAudience(target, "CSE 3B", db, teacherOfA);
assert.match(error, /only restrict/i, "teacher scoping to a class they don't teach is rejected");
assert.equal(target.audience, undefined, "target is left unmodified on rejection");

console.log("audience tests passed");
