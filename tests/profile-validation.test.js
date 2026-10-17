// Dependency-free unit tests for the Phase 1 profile validator.
import assert from "node:assert/strict";
import { safeProfileUrl, validateProfileUpdate } from "../server/services/profileValidation.js";

const ok = (body) => { const r = validateProfileUpdate(body); assert.ok(r.updates, `expected valid: ${JSON.stringify(body)} -> ${r.message}`); return r.updates; };
const bad = (body, field) => { const r = validateProfileUpdate(body); assert.ok(!r.updates, `expected invalid: ${JSON.stringify(body)}`); if (field !== undefined) assert.equal(r.field, field); return r; };

// Valid updates are trimmed and normalised.
assert.deepEqual(ok({ phone: "  +91 98765 43210 ", guardian: " Asha ", bio: "  Hello\nworld  ", emergencyContactName: " Ravi ", emergencyContactPhone: " +91-98765 43210 " }),
  { phone: "+91 98765 43210", guardian: "Asha", bio: "Hello\nworld", emergencyContactName: "Ravi", emergencyContactPhone: "+91-98765 43210" });
assert.deepEqual(ok({ skills: [" React ", "react", "Node.js"] }).skills, ["React", "Node.js"]);
assert.equal(ok({ linkedin: "https://www.linkedin.com/in/someone" }).linkedin, "https://www.linkedin.com/in/someone");
assert.equal(ok({ github: "https://github.com/someone" }).github, "https://github.com/someone");
assert.equal(ok({ linkedin: "", github: "" }).github, "");
assert.equal(ok({ skills: [] }).skills.length, 0);
assert.equal(ok({ phone: "x".repeat(120) }).phone.length, 120);
assert.equal(ok({ bio: "b".repeat(300) }).bio.length, 300);
assert.equal(ok({ skills: Array.from({ length: 10 }, (_, i) => `s${i}`) }).skills.length, 10);

// Unknown / forbidden keys.
for (const key of ["name", "rollNumber", "className", "department", "email", "password", "approvalStatus", "photoId", "active", "id", "role", "passwordVersion", "__proto__"]) {
  const body = JSON.parse(`{"phone":"1","${key}":"x"}`);
  bad(body, null);
}
bad({}); bad([]); bad(null); bad("x"); bad(undefined);

// Length / type limits.
bad({ phone: "x".repeat(121) }, "phone");
bad({ guardian: "x".repeat(121) }, "guardian");
bad({ bio: "b".repeat(301) }, "bio");
bad({ bio: 5 }, "bio"); bad({ phone: null }, "phone"); bad({ phone: ["1"] }, "phone");
bad({ skills: Array.from({ length: 11 }, (_, i) => `s${i}`) }, "skills");
bad({ skills: ["x".repeat(31)] }, "skills");
bad({ skills: ["ok", "   "] }, "skills"); bad({ skills: ["ok", 3] }, "skills"); bad({ skills: "React" }, "skills");
bad({ emergencyContactName: "n".repeat(81) }, "emergencyContactName");
bad({ emergencyContactPhone: "1".repeat(21) }, "emergencyContactPhone");
bad({ emergencyContactPhone: "98765abc" }, "emergencyContactPhone");
bad({ emergencyContactPhone: "(98765)" }, "emergencyContactPhone");
bad({ emergencyContactPhone: "+ -" }, "emergencyContactPhone");
bad({ phone: "12\u0000" }, "phone"); bad({ guardian: "a\nb" }, "guardian");

// URL rules.
for (const url of ["http://github.com/x", "javascript:alert(1)", "data:text/html,x", "ftp://github.com/x", "https://evil-github.com/x", "https://github.com.evil.io/x",
  "https://notgithub.com/x", "https://user:pw@github.com/x", "https://github.com:8443/x", "//github.com/x", "github.com/x", "https://github.com/x y", "https://linkedin.com/in/x"]) {
  bad({ github: url }, "github");
}
bad({ linkedin: "https://github.com/x" }, "linkedin");
bad({ linkedin: "http://www.linkedin.com/in/x" }, "linkedin");
bad({ linkedin: "https://linkedin.com.attacker.example/in/x" }, "linkedin");
bad({ github: "https://github.com/" + "a".repeat(200) }, "github");
assert.equal(safeProfileUrl("https://in.linkedin.com/in/x", "linkedin"), "https://in.linkedin.com/in/x");
assert.equal(safeProfileUrl("HTTPS://GitHub.com/x", "github"), "https://github.com/x");
assert.equal(safeProfileUrl("https://github.com/x", "other"), null);
assert.equal(safeProfileUrl(42, "github"), null);

console.log("Profile validation unit tests passed.");
