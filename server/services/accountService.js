// Shared account-identity helpers.
//
// Email uniqueness used to be checked ad hoc in each route, and each route
// only looked at its *own* collection: routes/students.js checked
// db.students, routes/teachers.js checked db.teachers. An address already
// used by a teacher therefore sailed through student registration and
// produced two accounts sharing one login address - at which point login
// resolution becomes order-dependent and the second account is effectively
// unreachable. These helpers check every collection that can hold a login,
// so there is one answer to "is this email taken?" no matter which route
// asks.

// Every collection whose records can authenticate. Keep this list in sync
// with getAccount() in server/middleware/auth.js.
const ACCOUNT_COLLECTIONS = ["students", "teachers", "admins"];

// Stored emails are normalized on write, but records seeded or written
// before that was true may still carry mixed case or padding, so compare
// normalized on both sides rather than trusting the stored form.
export function normalizeEmail(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function normalizeRollNumber(value) {
  return String(value ?? "").trim().toLowerCase();
}

// Walks students, teachers and admins. `ignoreId` exempts the record being
// updated, so "save" on an unchanged profile doesn't collide with itself.
export function emailInUse(db, email, { ignoreId = null } = {}) {
  const target = normalizeEmail(email);
  if (!target) return false;
  return ACCOUNT_COLLECTIONS.some((collection) =>
    (db?.[collection] || []).some(
      (record) => record && record.id !== ignoreId && normalizeEmail(record.email) === target
    )
  );
}

// Returns the matching account (with its collection) or null, for callers
// that need to know *which* account holds the address, not just that one
// does.
export function accountForEmail(db, email) {
  const target = normalizeEmail(email);
  if (!target) return null;
  for (const collection of ACCOUNT_COLLECTIONS) {
    const record = (db?.[collection] || []).find((item) => item && normalizeEmail(item.email) === target);
    if (record) return { record, collection };
  }
  return null;
}

// Roll numbers are the registrar-facing identifier and are assumed unique
// across the college; duplicates silently break per-student attendance
// reconciliation and any fee lookup that joins on them.
export function rollNumberInUse(db, rollNumber, { ignoreId = null } = {}) {
  const target = normalizeRollNumber(rollNumber);
  if (!target) return false;
  return (db?.students || []).some(
    (student) => student && student.id !== ignoreId && normalizeRollNumber(student.rollNumber) === target
  );
}

// Pending signup queues are separate from the live collections above: an
// address can be free in `students` while a request for it is already
// awaiting approval. Checked alongside emailInUse() wherever a *new*
// registration is being accepted.
export function emailPending(db, email) {
  const target = normalizeEmail(email);
  if (!target) return false;
  const pendingStudents = (db?.pendingStudents || []).some(
    (item) => item && normalizeEmail(item.email) === target && item.approvalStatus === "pending"
  );
  const pendingRequests = (db?.pendingAccessRequests || []).some(
    (item) => item && normalizeEmail(item.email) === target && item.status === "pending"
  );
  return pendingStudents || pendingRequests;
}
