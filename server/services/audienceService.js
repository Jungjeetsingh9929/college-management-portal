import { classesTaughtByTeacher } from "./accessService.js";

// Same shape as events.js's inline audience checks: "all" (or unset, for
// any item created before an audience field existed) is visible to
// everyone; anything else is a className restriction. Kept dependency-free
// (no express, no fileStore/pg) so it can be unit-tested directly.
export function audienceVisibleTo(itemAudience, user, db) {
  if (!itemAudience || itemAudience === "all") return true;
  if (user.role === "admin") return true;
  if (user.role === "teacher") return classesTaughtByTeacher(db, user.code).includes(itemAudience);
  const student = (db.students || []).find((entry) => entry.id === user.id);
  return Boolean(student && student.className === itemAudience);
}

// Validates and applies the audience field onto `target`; returns an error
// message or null. A teacher may only scope to a class they teach; an admin
// may scope to any class.
export function applyAudience(target, rawAudience, db, user) {
  let audience = rawAudience === undefined || rawAudience === "" ? "all" : String(rawAudience).trim().slice(0, 80);
  if (!audience) audience = "all";
  if (audience !== "all" && user.role === "teacher" && !classesTaughtByTeacher(db, user.code).includes(audience)) {
    return "You can only restrict this item to a class you teach.";
  }
  target.audience = audience;
  return null;
}
