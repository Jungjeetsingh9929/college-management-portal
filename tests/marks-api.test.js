// Integration test: boots the real Express app and drives the whole marks
// workflow over HTTP - permission matrix for every role, invalid input,
// one-way status transitions, GPA maths, exports, cleanup.
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-attendance-secret-32-chars-long";
process.env.SEED_ADMIN_EMAIL = "admin@example.edu";
process.env.SEED_ADMIN_PASSWORD = "Test-admin-password1!";
process.env.SEED_STUDENT_PASSWORD = "Test-student-password1!";
process.env.E2E_FACULTY_PASSWORD = "Test-e2e-faculty1!";
process.env.E2E_ADMIN_PASSWORD = "Test-e2e-admin1!";
process.env.DEMO_LOGIN_PASSWORD = "Test-demo-login1!";
process.env.FACULTY_LRG_PASSWORD = "Test-lrg-faculty1!";
process.env.COLLEGE_LATITUDE = "27.2124649";
process.env.COLLEGE_LONGITUDE = "75.7002425";
process.env.COLLEGE_RADIUS_METERS = "300";
// This test makes several hundred requests in a few seconds.
process.env.PUBLIC_API_LIMIT = "100000";
process.env.ADMIN_API_LIMIT = "100000";
process.env.AUTH_API_LIMIT = "100000";
process.env.AUTH_LOGIN_IP_LIMIT = "1000";
process.env.AUTH_LOGIN_ACCOUNT_LIMIT = "1000";

import assert from "node:assert/strict";

const GRADE_POINTS = { O: 10, "A+": 9, A: 8, "B+": 7, B: 6, C: 5, P: 4, F: 0 };

const { readDb, resetDb } = await import("../server/db/fileStore.js");
const { default: app } = await import("../server/index.js");
await resetDb();
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const base = `http://127.0.0.1:${server.address().port}/api`;

async function call(method, path, token, body) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = {}; }
  return { status: response.status, data, text, headers: response.headers };
}
const ok = async (method, path, token, body) => {
  const result = await call(method, path, token, body);
  assert.ok(result.status < 400, `${method} ${path} -> ${result.status} ${result.data.message || ""}`);
  return result;
};
const expectStatus = async (status, method, path, token, body, label = "") => {
  const result = await call(method, path, token, body);
  assert.equal(result.status, status, `${label || `${method} ${path}`} expected ${status}, got ${result.status} (${result.data.message || ""})`);
  return result;
};
const login = async (email, password, role) => (await ok("POST", "/auth/login", null, { email, password, role })).data;

try {
  // ---------------------------------------------------------------- accounts
  const admin = (await login("admin@example.edu", "Test-admin-password1!", "admin")).token;
  const student1 = await login("student001@example.edu", "Test-student-password1!", "student");
  const stu = student1.token;

  const password = "Marks-test-password1!";
  async function makeTeacher(code, name, department = "Computer Science") {
    const email = `${code.toLowerCase()}@marks.example.edu`;
    const created = await ok("POST", "/teachers", admin, { code, name, department, email, password, subjects: [] });
    return { id: created.data.teacher.id, token: (await login(email, password, "teacher")).token };
  }
  const owner = await makeTeacher("MKT1", "Owner Teacher");
  const coTeacher = await makeTeacher("MKT2", "Co Teacher");
  const labTeacher = await makeTeacher("MKT3", "Lab Teacher");
  const outsider = await makeTeacher("MKX", "Outsider Teacher");
  const substring = await makeTeacher("MK", "Substring Teacher");
  const hod = await makeTeacher("MKHOD", "CS HOD");
  const otherHod = await makeTeacher("MKHOD2", "Electronics HOD", "Electronics");

  const departments = (await ok("GET", "/admin/departments", admin)).data.departments;
  const cs = departments.find((item) => item.name === "Computer Science");
  const electronics = departments.find((item) => item.name === "Electronics");
  await ok("PUT", `/admin/departments/${cs.id}`, admin, { name: cs.name, hodId: hod.id });
  await ok("PUT", `/admin/departments/${electronics.id}`, admin, { name: electronics.name, hodId: otherHod.id });

  // ------------------------------------------------- subjects: credits / semester
  const subjectBody = (over = {}) => ({ subjectName: "Marks Algorithms", code: "MKA101", teacher: "MKT1, MKT2 :: MKT3(LAB-1)", className: "CSE 3A", department: "Computer Science", semester: "5", credits: 4, ...over });
  await expectStatus(400, "POST", "/subjects", admin, subjectBody({ code: "BAD1", credits: -1 }), "negative credits");
  await expectStatus(400, "POST", "/subjects", admin, subjectBody({ code: "BAD2", credits: 0.3 }), "credits not a half step");
  await expectStatus(400, "POST", "/subjects", admin, subjectBody({ code: "BAD3", credits: 21 }), "credits too high");
  await expectStatus(400, "POST", "/subjects", admin, subjectBody({ code: "BAD4", credits: "abc" }), "credits text");
  await expectStatus(400, "POST", "/subjects", admin, subjectBody({ code: "BAD5", semester: "13" }), "semester 13");
  await expectStatus(400, "POST", "/subjects", admin, subjectBody({ code: "BAD6", semester: "Fall" }), "semester text");
  await expectStatus(400, "POST", "/subjects", admin, subjectBody({ code: "BAD7", extra: 1 }), "unknown field");
  await expectStatus(403, "POST", "/subjects", owner.token, subjectBody({ code: "BAD8" }), "teacher can't create subjects");
  const s1 = (await ok("POST", "/subjects", admin, subjectBody())).data.subject;
  const s2 = (await ok("POST", "/subjects", admin, subjectBody({ subjectName: "Marks Databases", code: "MKA102", teacher: "MKT1", semester: "5", credits: 3 }))).data.subject;
  const s3 = (await ok("POST", "/subjects", admin, subjectBody({ subjectName: "Marks Mentoring", code: "MKA103", teacher: "MKT1", semester: "5", credits: "0" }))).data.subject;
  const s4 = (await ok("POST", "/subjects", admin, subjectBody({ subjectName: "Marks Unset", code: "MKA104", teacher: "MKT1", semester: "", credits: "" }))).data.subject;
  const s5 = (await ok("POST", "/subjects", admin, subjectBody({ subjectName: "Marks Sem6", code: "MKA201", teacher: "MKT1", semester: 6, credits: 2 }))).data.subject;
  assert.equal(s1.credits, 4);
  assert.equal(s3.credits, 0);
  assert.equal(s4.credits, null);
  assert.equal(s4.semester, "");
  assert.equal(s5.semester, "6", "numeric semester is stored as a string");

  // ------------------------------------------------------- subject listing scope
  const idsOf = async (token) => (await ok("GET", "/marks/subjects", token)).data.subjects.map((item) => item.id);
  const adminIds = await idsOf(admin);
  for (const subject of [s1, s2, s3, s4, s5]) assert.ok(adminIds.includes(subject.id), "admin sees every subject");
  assert.ok(adminIds.length > 100, "admin sees the full catalogue");
  const ownerIds = await idsOf(owner.token);
  assert.deepEqual([...ownerIds].sort(), [s1, s2, s3, s4, s5].map((item) => item.id).sort(), "owner sees exactly their subjects");
  assert.deepEqual(await idsOf(coTeacher.token), [s1.id], "second teacher in a list sees only that subject");
  assert.deepEqual(await idsOf(labTeacher.token), [s1.id], "MKT3(LAB-1) annotation still matches");
  assert.deepEqual(await idsOf(outsider.token), [], "unrelated teacher sees nothing");
  assert.deepEqual(await idsOf(substring.token), [], "code MK is a substring of MKT1 but owns nothing");
  const hodIds = await idsOf(hod.token);
  for (const subject of [s1, s2, s3, s4, s5]) assert.ok(hodIds.includes(subject.id), "CS HOD oversees CSE 3A subjects");
  const otherHodIds = await idsOf(otherHod.token);
  for (const subject of [s1, s2, s3, s4, s5]) assert.ok(!otherHodIds.includes(subject.id), "Electronics HOD does not oversee CSE 3A subjects");
  await expectStatus(403, "GET", "/marks/subjects", stu, undefined, "student can't list staff subjects");
  await expectStatus(401, "GET", "/marks/subjects", null, undefined, "anonymous");
  await expectStatus(400, "GET", "/marks/subjects?status=bogus", admin);
  const filtered = (await ok("GET", "/marks/subjects?semester=6", owner.token)).data;
  assert.deepEqual(filtered.subjects.map((item) => item.id), [s5.id]);
  assert.equal(filtered.counts.none, 5, "counts ignore the filter");

  // ------------------------------------------------------------- sheet access
  const sheetPath = (subject) => `/marks/sheet/${subject.id}`;
  const view = (await ok("GET", sheetPath(s1), owner.token)).data;
  assert.equal(view.sheet.status, "draft");
  assert.equal(view.sheet.exists, false);
  assert.equal(view.sheet.internalMax, 40);
  assert.equal(view.sheet.endSemMax, 60);
  assert.equal(view.access.role, "teacher");
  assert.equal(view.access.canEdit, true);
  const roster = view.students;
  assert.ok(roster.length >= 3, "CSE 3A has students");
  assert.ok(roster.some((item) => item.studentId === student1.user.id));
  assert.ok(view.students.every((item) => item.internal === null && !item.complete));
  await ok("GET", sheetPath(s1), admin);
  await ok("GET", sheetPath(s1), coTeacher.token);
  const hodView = (await ok("GET", sheetPath(s1), hod.token)).data;
  assert.equal(hodView.access.role, "hod");
  assert.equal(hodView.access.canEdit, false);
  await expectStatus(403, "GET", sheetPath(s1), outsider.token);
  await expectStatus(403, "GET", sheetPath(s1), substring.token);
  await expectStatus(403, "GET", sheetPath(s1), otherHod.token);
  await expectStatus(403, "GET", sheetPath(s1), stu);
  await expectStatus(404, "GET", "/marks/sheet/does-not-exist", admin);
  await expectStatus(404, "GET", "/marks/sheet/bad%20id", admin);

  // -------------------------------------------------------------- saving marks
  const save = (token, body, subject = s1) => call("PUT", sheetPath(subject), token, body);
  const first = roster[0].studentId;
  const second = roster[1].studentId;
  assert.equal((await save(stu, { entries: [] })).status, 403, "student cannot save");
  assert.equal((await save(outsider.token, { entries: [] })).status, 403);
  assert.equal((await save(substring.token, { entries: [] })).status, 403);
  assert.equal((await save(hod.token, { entries: [] })).status, 403, "HOD is read-only on a draft");
  assert.equal((await save(otherHod.token, { entries: [] })).status, 403);
  const bad = async (body, label) => { const r = await save(owner.token, body); assert.equal(r.status, 400, `${label}: ${r.status} ${r.data.message}`); };
  await bad({ bogus: 1 }, "unknown top-level field");
  await bad({ entries: "x" }, "entries not an array");
  await bad({ entries: [{ studentId: first, bogus: 1 }] }, "unknown entry field");
  await bad({ entries: [{ studentId: first, internal: 41 }] }, "internal above max");
  await bad({ entries: [{ studentId: first, endSem: 61 }] }, "end-sem above max");
  await bad({ entries: [{ studentId: first, internal: -1 }] }, "negative");
  await bad({ entries: [{ studentId: first, internal: 10.3 }] }, "not a half step");
  await bad({ entries: [{ studentId: first, internal: "x" }] }, "text mark");
  await bad({ entries: [{ studentId: "stu-011", internal: 10 }] }, "student outside the class");
  await bad({ entries: [{ studentId: "nope", internal: 10 }] }, "unknown student");
  await bad({ entries: [{ studentId: first, internal: 1 }, { studentId: first, internal: 2 }] }, "duplicate student");
  await bad({ entries: [{ studentId: first, absent: "yes" }] }, "absent not boolean");
  await bad({ entries: [{ studentId: first, absent: true, endSem: 10 }] }, "absent with end-sem marks");
  await bad({ entries: [{ studentId: first, remarks: "x".repeat(201) }] }, "remarks too long");
  await bad({ entries: [{ studentId: first, remarks: 5 }] }, "remarks not text");
  await bad({ internalMax: 0, endSemMax: 0 }, "both maximums zero");
  await bad({ internalMax: 501 }, "max above 500");
  await bad({ internalMax: -5 }, "negative max");
  await bad({ internalMax: 10.5 }, "fractional max");
  await bad({ entries: Array.from({ length: 501 }, () => ({ studentId: first })) }, "too many entries");
  // Nothing above may have been written (validation is all-or-nothing).
  assert.equal((await ok("GET", sheetPath(s1), owner.token)).data.sheet.exists, false, "rejected saves leave no sheet behind");
  await bad({ entries: [{ studentId: first, internal: 30 }, { studentId: second, internal: 99 }] }, "one bad row rejects the whole batch");
  assert.ok((await ok("GET", sheetPath(s1), owner.token)).data.students.every((item) => item.internal === null), "batch was atomic");

  // A good partial save, then changing the max below an existing mark is rejected.
  let saved = (await ok("PUT", sheetPath(s1), owner.token, { entries: [{ studentId: first, internal: 36, endSem: 54, remarks: "Top of class" }] })).data;
  assert.equal(saved.sheet.exists, true);
  const firstRow = saved.students.find((item) => item.studentId === first);
  assert.deepEqual([firstRow.internal, firstRow.endSem, firstRow.absent, firstRow.remarks, firstRow.complete], [36, 54, false, "Top of class", true]);
  assert.deepEqual(firstRow.outcome, { totalMarks: 90, totalMax: 100, percentage: 90, grade: "O", gradePoints: 10, passed: true });
  await bad({ internalMax: 30 }, "lowering the max below an existing mark");
  // Omitted fields are unchanged; null clears.
  saved = (await ok("PUT", sheetPath(s1), owner.token, { entries: [{ studentId: first, remarks: "Updated" }] })).data;
  assert.equal(saved.students.find((item) => item.studentId === first).internal, 36);
  assert.equal(saved.students.find((item) => item.studentId === first).remarks, "Updated");
  saved = (await ok("PUT", sheetPath(s1), owner.token, { entries: [{ studentId: first, endSem: null }] })).data;
  assert.equal(saved.students.find((item) => item.studentId === first).endSem, null);
  assert.equal(saved.students.find((item) => item.studentId === first).complete, false);
  // The legacy internalMarks row keeps its original meaning.
  const legacy = (await readDb()).internalMarks.find((row) => row.studentId === first && row.subjectId === s1.id);
  assert.equal(legacy.marks, 36);
  assert.equal(legacy.maxMarks, 40);
  // The old single-mark endpoint is retired.
  await expectStatus(410, "PUT", "/faculty/marks", owner.token, { studentId: first, subjectId: s1.id, marks: 5, maxMarks: 100 });

  // ------------------------------------------------------------ publish guards
  const noPublish = async (token, expected, subject = s1, label = "") => (await expectStatus(expected, "POST", `${sheetPath(subject)}/publish`, token, {}, label));
  await noPublish(stu, 403, s1, "student");
  await noPublish(outsider.token, 403, s1, "outsider");
  await noPublish(substring.token, 403, s1, "substring teacher");
  await noPublish(hod.token, 403, s1, "HOD can't publish");
  await noPublish(otherHod.token, 403, s1, "other HOD");
  const incomplete = await noPublish(owner.token, 409, s1, "incomplete rows");
  assert.equal(incomplete.data.missingCount, roster.length);
  assert.ok(Array.isArray(incomplete.data.missing));
  await expectStatus(400, "POST", `${sheetPath(s1)}/publish`, owner.token, { junk: 1 }, "unknown field on publish");
  await noPublish(owner.token, 409, s2, "no sheet yet");
  // Subject without semester/credits can't be published even when complete.
  const s4Roster = (await ok("GET", sheetPath(s4), owner.token)).data;
  assert.ok(s4Roster.readiness.problems.length === 2, "both semester and credits flagged");
  await ok("PUT", sheetPath(s4), owner.token, { entries: s4Roster.students.map((item) => ({ studentId: item.studentId, internal: 30, endSem: 50 })) });
  const s4Publish = await noPublish(owner.token, 409, s4, "no semester/credits");
  assert.match(s4Publish.data.message, /semester|credits/i);

  // ------------------------------------------------- fill the sheet and publish S1
  // Grades chosen to hit different bands; the last student is absent.
  const plan = roster.map((item, index) => {
    if (index === 0) return { studentId: item.studentId, internal: 36, endSem: 54 };            // 90  -> O  (10)
    if (index === 1) return { studentId: item.studentId, internal: 30, endSem: 50 };            // 80  -> A+ (9)
    if (index === 2) return { studentId: item.studentId, internal: 16, endSem: 24 };            // 40  -> P  (4)
    if (index === roster.length - 1) return { studentId: item.studentId, internal: 35, absent: true, endSem: null }; // AB -> F (0)
    return { studentId: item.studentId, internal: 28, endSem: 42 };                             // 70  -> A  (8)
  });
  await ok("PUT", sheetPath(s1), owner.token, { entries: plan });
  const beforePublish = (await ok("GET", sheetPath(s1), coTeacher.token)).data;
  assert.equal(beforePublish.readiness.ready, true);
  assert.equal(beforePublish.students[beforePublish.students.length - 1].outcome.grade, "F");

  // Student sees nothing while it is a draft.
  const draftResults = (await ok("GET", "/marks/me", stu)).data;
  assert.equal(draftResults.semesters.length, 0);
  assert.equal(draftResults.cgpa, null);

  const published = (await ok("POST", `${sheetPath(s1)}/publish`, coTeacher.token, {})).data;
  assert.equal(published.sheet.status, "published");
  assert.equal(published.published, roster.length);
  assert.equal(published.access.canEdit, false);
  assert.equal(published.access.canLock, false, "teacher can't lock");

  // Publish is one-way: no second publish, no edits.
  await noPublish(owner.token, 409, s1, "publish twice");
  await expectStatus(409, "PUT", sheetPath(s1), owner.token, { entries: [{ studentId: first, internal: 1 }] }, "edit after publish");
  await expectStatus(409, "PUT", sheetPath(s1), admin, { entries: [{ studentId: first, internal: 1 }] }, "admin edit after publish");
  await expectStatus(403, "PUT", sheetPath(s1), stu, { entries: [] });

  // ----------------------------------------------------------- student results
  const mine = (await ok("GET", "/marks/me", stu)).data;
  const myIndex = roster.findIndex((item) => item.studentId === student1.user.id);
  const expectedGrade = plan[myIndex].absent ? "F" : { 0: "O", 1: "A+", 2: "P" }[myIndex] || "A";
  assert.equal(mine.semesters.length, 1);
  assert.equal(mine.semesters[0].semester, 5);
  assert.equal(mine.semesters[0].subjects.length, 1);
  const result = mine.semesters[0].subjects[0];
  assert.equal(result.grade, expectedGrade);
  assert.equal(result.subjectName, "Marks Algorithms");
  assert.equal(result.credits, 4);
  assert.equal(mine.semesters[0].sgpa, GRADE_POINTS[expectedGrade]);
  assert.equal(mine.cgpa, GRADE_POINTS[expectedGrade]);
  assert.ok(!("publishedBy" in result) && !("sheetId" in result) && !("studentId" in result), "internal bookkeeping isn't exposed");
  assert.equal(mine.student.id, student1.user.id);
  await expectStatus(403, "GET", "/marks/me", owner.token, undefined, "teacher on /me");
  await expectStatus(403, "GET", "/marks/me", admin, undefined, "admin on /me");
  await expectStatus(403, "GET", `/marks/students/${student1.user.id}`, stu, undefined, "student on staff transcript");

  // Student portal + bell notification both reflect the published result.
  const portal = (await ok("GET", "/shared/student/portal", stu)).data;
  assert.equal(portal.academics.sgpa, GRADE_POINTS[expectedGrade]);
  assert.equal(portal.academics.cgpa, GRADE_POINTS[expectedGrade]);
  assert.equal(portal.academics.subjects[0].code, "MKA101");
  const notifications = (await ok("GET", "/shared/notifications", stu)).data.notifications;
  const resultBell = notifications.find((item) => item.category === "result");
  assert.ok(resultBell, "a Result published notification exists");
  assert.equal(resultBell.href, "/my-results");

  // Multi-subject SGPA / CGPA across two semesters (student in position 3+ has grade A = 8).
  const pos = roster.findIndex((item, index) => index >= 3 && index < roster.length - 1);
  const target = roster[pos];
  // S2: 3 credits. Give everyone 60/100 (B+, 7). S3: 0 credits (excluded). S5: sem 6, 2 credits, everyone 85 (A+, 9).
  const fillAll = (subject, internal, endSem) => ok("PUT", sheetPath(subject), owner.token, { entries: roster.map((item) => ({ studentId: item.studentId, internal, endSem })) });
  await fillAll(s2, 24, 36);
  await fillAll(s3, 40, 60);
  await fillAll(s5, 34, 51);
  for (const subject of [s2, s3, s5]) await ok("POST", `${sheetPath(subject)}/publish`, owner.token, {});
  const s1Points = GRADE_POINTS[grade(plan[pos])];
  // Semester 5: S1 (4cr) + S2 (3cr, 7) ; S3 is 0 credits so excluded. Semester 6: S5 (2cr, 9).
  const adminView = (await ok("GET", `/marks/students/${target.studentId}`, admin)).data;
  const sem5 = adminView.semesters.find((item) => item.semester === 5);
  const sem6 = adminView.semesters.find((item) => item.semester === 6);
  assert.equal(sem5.subjects.length, 3, "the non-credit subject is listed");
  assert.equal(sem5.credits, 7, "but adds no credits");
  assert.equal(sem5.sgpa, Math.round(((4 * s1Points + 3 * 7) / 7) * 100) / 100);
  assert.equal(sem6.sgpa, 9);
  assert.equal(adminView.cgpa, Math.round(((4 * s1Points + 3 * 7 + 2 * 9) / 9) * 100) / 100);
  assert.equal(adminView.totalCredits, 9);
  assert.ok(adminView.semesters[0].semester < adminView.semesters[1].semester);
  const nonCredit = sem5.subjects.find((item) => item.code === "MKA103");
  assert.equal(nonCredit.countsTowardGpa, false);

  // ----------------------------------------------------- staff transcripts scope
  const csStudent = student1.user.id;
  await ok("GET", `/marks/students/${csStudent}`, hod.token);
  await expectStatus(403, "GET", `/marks/students/${csStudent}`, otherHod.token, undefined, "other department's HOD");
  await expectStatus(403, "GET", `/marks/students/${csStudent}`, owner.token, undefined, "subject teacher has no transcript access");
  await expectStatus(403, "GET", `/marks/students/${csStudent}`, substring.token);
  await expectStatus(404, "GET", "/marks/students/nobody", admin);
  await expectStatus(404, "GET", "/marks/students/bad%20id", admin);

  // -------------------------------------------------------------- lock / unlock
  const lock = (token, subject = s1) => call("POST", `${sheetPath(subject)}/lock`, token, {});
  const unlock = (token, body, subject = s1) => call("POST", `${sheetPath(subject)}/unlock`, token, body);
  assert.equal((await lock(stu)).status, 403);
  assert.equal((await lock(owner.token)).status, 403, "subject teacher can't lock");
  assert.equal((await lock(coTeacher.token)).status, 403);
  assert.equal((await lock(outsider.token)).status, 403);
  assert.equal((await lock(otherHod.token)).status, 403, "other department's HOD can't lock");
  assert.equal((await lock(substring.token)).status, 403);
  assert.equal((await lock(admin, s4)).status, 409, "a draft can't be locked");
  const locked = await lock(hod.token);
  assert.equal(locked.status, 200);
  assert.equal(locked.data.sheet.status, "locked");
  assert.equal((await lock(hod.token)).status, 409, "lock twice");
  assert.equal((await lock(admin)).status, 409);
  assert.equal((await call("GET", "/marks/me", stu)).data.semesters[0].subjects[0].locked, true);

  assert.equal((await unlock(owner.token, { reason: "Please reopen this" })).status, 403, "teacher can't unlock");
  assert.equal((await unlock(hod.token, { reason: "Please reopen this" })).status, 403, "HOD can't unlock");
  assert.equal((await unlock(stu, { reason: "Please reopen this" })).status, 403);
  assert.equal((await unlock(admin, {})).status, 400, "reason required");
  assert.equal((await unlock(admin, { reason: "" })).status, 400);
  assert.equal((await unlock(admin, { reason: "abc" })).status, 400, "reason too short");
  assert.equal((await unlock(admin, { reason: "x".repeat(301) })).status, 400, "reason too long");
  assert.equal((await unlock(admin, { reason: "Valid reason here", extra: 1 })).status, 400);
  assert.equal((await unlock(admin, { reason: "Valid reason here" }, s4)).status, 409, "draft can't be unlocked");

  // Subject fields the sheet depends on are frozen; deletion is blocked.
  await expectStatus(409, "PUT", `/subjects/${s1.id}`, admin, { credits: 3 }, "credits frozen");
  await expectStatus(409, "PUT", `/subjects/${s1.id}`, admin, { semester: "6" }, "semester frozen");
  await expectStatus(409, "PUT", `/subjects/${s1.id}`, admin, { className: "CSE 2B" }, "class frozen");
  await expectStatus(409, "DELETE", `/subjects/${s1.id}`, admin, undefined, "delete blocked while results are published");
  await ok("PUT", `/subjects/${s1.id}`, admin, { room: "Room 9", credits: 4, semester: "5" }); // unchanged values + harmless field are fine
  await expectStatus(409, "PUT", `/subjects/${s3.id}`, admin, { credits: 1 }, "published subject frozen too");

  const unlocked = await unlock(admin, { reason: "Re-evaluation of paper 2" });
  assert.equal(unlocked.status, 200);
  assert.equal(unlocked.data.sheet.status, "draft");
  assert.ok(unlocked.data.withdrawn >= roster.length);
  assert.equal(unlocked.data.sheet.history[0].action, "unlock");
  assert.equal(unlocked.data.sheet.history[0].reason, "Re-evaluation of paper 2");
  assert.ok(unlocked.data.sheet.history.some((item) => item.action === "publish"));
  assert.ok(unlocked.data.sheet.history.some((item) => item.action === "lock"));
  assert.equal((await unlock(admin, { reason: "Valid reason here" })).status, 409, "unlock twice");
  const db = await readDb();
  assert.ok(!db.results.some((item) => item.subjectId === s1.id), "results are withdrawn on unlock");
  assert.ok(db.results.some((item) => item.subjectId === s2.id), "other subjects are untouched");
  const audit = db.auditLogs.filter((item) => item.action === "marks.unlock");
  assert.equal(audit.length, 1);
  assert.equal(audit[0].newValue.reason, "Re-evaluation of paper 2");
  assert.equal(audit[0].previousValue.status, "locked");
  assert.equal(audit[0].severity, "warning");
  assert.deepEqual(db.auditLogs.filter((item) => item.action === "marks.publish").length >= 4, true);
  assert.ok(db.auditLogs.some((item) => item.action === "marks.lock"));
  // Student no longer sees S1 and the CGPA drops it.
  const afterUnlock = (await ok("GET", "/marks/me", stu)).data;
  assert.equal(afterUnlock.semesters[0].subjects.every((item) => item.code !== "MKA101"), true);
  // Teacher corrects and re-publishes; the class-change block lifts only for drafts without marks (still blocked: marks exist).
  await expectStatus(409, "PUT", `/subjects/${s1.id}`, admin, { className: "CSE 2B" }, "class change blocked while marks exist");
  await ok("PUT", `/subjects/${s1.id}`, admin, { credits: 3 }); // draft again: credits may change
  await ok("PUT", sheetPath(s1), owner.token, { entries: [{ studentId: first, internal: 40 }] });
  const republish = (await ok("POST", `${sheetPath(s1)}/publish`, owner.token, {})).data;
  assert.equal(republish.sheet.status, "published");
  const dbAfter = await readDb();
  assert.equal(dbAfter.results.filter((item) => item.subjectId === s1.id).length, roster.length, "exactly one result per student, no duplicates");
  assert.ok(dbAfter.results.filter((item) => item.subjectId === s1.id).every((item) => item.credits === 3), "snapshot uses the credits at publication");
  // A later subject rename must not change the snapshot.
  await ok("PUT", `/subjects/${s1.id}`, admin, { subjectName: "Renamed Algorithms" });
  assert.equal((await ok("GET", "/marks/me", stu)).data.semesters[0].subjects.find((item) => item.code === "MKA101").subjectName, "Marks Algorithms");

  // -------------------------------------------------------------------- exports
  const csv = await call("GET", `${sheetPath(s2)}/export.csv`, owner.token);
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get("content-type"), /text\/csv/);
  assert.match(csv.headers.get("content-disposition"), /attachment; filename="marks-MKA102-CSE-3A\.csv"/);
  const csvLines = csv.text.trim().split("\n");
  assert.equal(csvLines.length, roster.length + 1);
  assert.match(csvLines[0], /^"Roll number","Student","Class","Internal \(\/40\)","End-sem \(\/60\)"/);
  await expectStatus(403, "GET", `${sheetPath(s2)}/export.csv`, outsider.token);
  await expectStatus(403, "GET", `${sheetPath(s2)}/export.csv`, stu);
  await ok("GET", `${sheetPath(s2)}/export.csv`, hod.token);
  await ok("GET", `${sheetPath(s2)}/export.csv`, admin);

  const results = await call("GET", "/marks/export.csv?className=CSE%203A", admin);
  assert.equal(results.status, 200);
  assert.ok(results.text.split("\n").length > roster.length);
  assert.ok(results.text.includes('"MKA102"'));
  const hodResults = await call("GET", "/marks/export.csv?className=CSE%203A", hod.token);
  assert.equal(hodResults.status, 200);
  const otherHodResults = await call("GET", "/marks/export.csv?className=CSE%203A", otherHod.token);
  assert.equal(otherHodResults.status, 200);
  assert.equal(otherHodResults.text.trim().split("\n").length, 1, "other department's HOD gets headers only");
  await expectStatus(403, "GET", "/marks/export.csv", owner.token, undefined, "plain teacher");
  await expectStatus(403, "GET", "/marks/export.csv", substring.token);
  await expectStatus(403, "GET", "/marks/export.csv", stu);
  await expectStatus(400, "GET", "/marks/export.csv?view=bogus", admin);
  await expectStatus(400, "GET", "/marks/export.csv?view=summary", admin, undefined, "summary needs a semester");
  await expectStatus(400, "GET", "/marks/export.csv?semester=abc", admin);
  await expectStatus(400, "GET", "/marks/export.csv?subjectId=bad%20id", admin);
  const summaryCsv = await call("GET", "/marks/export.csv?view=summary&semester=5", admin);
  assert.equal(summaryCsv.status, 200);
  assert.match(summaryCsv.text.split("\n")[0], /"SGPA","CGPA/);
  assert.equal(summaryCsv.text.trim().split("\n").length, roster.length + 1);

  // Grade scale is public to any signed-in user.
  const scale = (await ok("GET", "/marks/grade-scale", stu)).data;
  assert.equal(scale.scale.length, 8);
  assert.equal(scale.passPercentage, 40);
  await expectStatus(401, "GET", "/marks/grade-scale", null);

  // ------------------------------------- subject delete + student delete cleanup
  await expectStatus(409, "DELETE", `/subjects/${s2.id}`, admin, undefined, "published subject");
  await ok("DELETE", `/subjects/${s4.id}`, admin); // draft with entries
  const afterDelete = await readDb();
  assert.ok(!afterDelete.markSheets.some((item) => item.subjectId === s4.id));
  assert.ok(!afterDelete.internalMarks.some((item) => item.subjectId === s4.id));
  const victim = roster[roster.length - 2].studentId;
  assert.ok(afterDelete.results.some((item) => item.studentId === victim));
  await ok("DELETE", `/students/${victim}`, admin);
  const afterStudentDelete = await readDb();
  assert.ok(!afterStudentDelete.results.some((item) => item.studentId === victim), "deleting a student removes their results");
  assert.ok(!afterStudentDelete.internalMarks.some((item) => item.studentId === victim));
  // Departed students don't block a later publish: roster shrinks.
  assert.equal((await ok("GET", sheetPath(s2), admin)).data.students.length, roster.length - 1);

  // Admin dashboard counter now counts published sheets.
  const overview = (await ok("GET", "/admin/overview", admin)).data;
  assert.equal(overview.examinationStats.publishedResults, 4, "S1, S2, S3, S5 are published");

  console.log("marks-api tests passed");
} finally {
  server.close();
}

function grade(entry) {
  if (entry.absent) return "F";
  const pct = entry.internal + entry.endSem;
  if (pct >= 90) return "O";
  if (pct >= 80) return "A+";
  if (pct >= 70) return "A";
  if (pct >= 60) return "B+";
  if (pct >= 50) return "B";
  if (pct >= 45) return "C";
  if (pct >= 40) return "P";
  return "F";
}
