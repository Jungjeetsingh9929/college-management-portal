const base = process.env.BASE_URL || "http://127.0.0.1:5055/api";
const creds = {
  admin: ["admin@example.edu", "Test-admin-password1!"],
  teacher: ["faculty-demo@example.edu", "Test-e2e-faculty1!"],
  student: ["student001@example.edu", "Test-student-password1!"]
};
async function req(path, options = {}) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : {}; } catch { body = text; }
  return { status: response.status, body };
}
async function login(role) {
  const [email, password] = creds[role];
  const result = await req("/auth/login", { method: "POST", body: JSON.stringify({ email, password, role }) });
  if (result.status !== 200) throw new Error(`${role} login failed: ${result.status} ${JSON.stringify(result.body)}`);
  return result.body.token;
}
const tokens = {};
for (const role of Object.keys(creds)) tokens[role] = await login(role);
const checks = [];
async function check(name, role, path, expected, method = "GET", body) {
  const authHeaders = role ? { Authorization: `Bearer ${tokens[role]}` } : {};
  const result = await req(path, { method, headers: authHeaders, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const ok = result.status === expected;
  checks.push({ name, role, path, expected, actual: result.status, ok, message: result.body?.message || null });
}
await check("student can view own portal", "student", "/shared/student/portal", 200);
await check("student can view public teachers", "student", "/teachers", 200);
await check("student cannot view admin fees", "student", "/admin/fees", 403);
await check("student cannot view admin security", "student", "/admin/security", 403);
await check("student cannot view faculty roster", "student", "/faculty/students", 403);
await check("teacher can view scoped roster", "teacher", "/faculty/students", 200);
await check("teacher cannot view admin fees", "teacher", "/admin/fees", 403);
await check("teacher cannot view admin security", "teacher", "/admin/security", 403);
await check("admin can view fees", "admin", "/admin/fees", 200);
await check("admin can view security", "admin", "/admin/security", 200);
await check("missing auth is rejected", null, "/admin/fees", 401, "GET", undefined);
await check("malformed JSON body rejected", "student", "/complaints", 400, "POST", []);
await check("unknown API route is 404", "student", "/does-not-exist", 404);
const failedLogin = await req("/auth/login", { method: "POST", body: JSON.stringify({ email: creds.student[0], password: "wrong-password", role: "student" }) });
checks.push({ name: "wrong password rejected", actual: failedLogin.status, expected: 401, ok: failedLogin.status === 401, message: failedLogin.body?.message || null });
console.log(JSON.stringify({ checks, passed: checks.filter((item) => item.ok).length, total: checks.length }, null, 2));
if (checks.some((item) => !item.ok)) process.exitCode = 1;
