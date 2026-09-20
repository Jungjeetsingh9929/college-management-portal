// Dependency-free (no express/db boot), like client-origin.test.js.
// Covers the Phase 8.1 hardening primitives: the password-check split
// (policy applies to passwords being SET, not to ones being CHECKED), and
// the bounded/canonical rate-limit bucket key built from a request body.
import assert from "node:assert/strict";
import { boundedKey, validExistingPassword, validPassword, validateKeys } from "../server/services/validation.js";
import { bodyFieldKey } from "../server/middleware/rateLimitKeys.js";

// --- password policy split ---------------------------------------------

// The policy for a password being set is unchanged.
assert.equal(validPassword("Str0ng!Passw0rd"), true);
assert.equal(validPassword("short1!A"), false, "under 12 characters");
assert.equal(validPassword("alllowercase1!"), false, "no upper case");
assert.equal(validPassword("NOLOWERCASE1!"), false, "no lower case");
assert.equal(validPassword("NoDigitsHere!!"), false, "no digit");
assert.equal(validPassword("NoSymbolsHere1"), false, "no symbol");
assert.equal(validPassword("A1!" + "a".repeat(200)), false, "over 200 characters");

// A password being checked is only bounded — a legacy hash must stay usable,
// otherwise the account can never reach change-password to rotate off it.
assert.equal(validExistingPassword("oldweak"), true);
assert.equal(validExistingPassword("Str0ng!Passw0rd"), true);
assert.equal(validExistingPassword(""), false, "empty is still rejected");
assert.equal(validExistingPassword("a".repeat(201)), false, "oversized is still rejected");
assert.equal(validExistingPassword(undefined), false);
assert.equal(validExistingPassword({ toString: () => "x" }), false, "non-string is rejected");

// --- rate-limit bucket keys --------------------------------------------

const key = bodyFieldKey("email");
const same = "student@example.edu";
assert.equal(key({ body: { email: same } }), same);
// Every spelling of one address must share a bucket, or the per-account
// login limit is bypassed by re-casing or padding the field.
assert.equal(key({ body: { email: "  STUDENT@Example.EDU  " } }), same);
assert.equal(key({ body: {} }), "unknown");
assert.equal(key({}), "unknown");

// An oversized field is hashed, not truncated: two long addresses sharing a
// prefix must not collapse into one bucket, and the key must stay short so
// the bucket map / rate-limit table can't be grown by long request bodies.
const longA = `${"a".repeat(300)}@example.edu`;
const longB = `${"a".repeat(300)}@example.org`;
const hashedA = key({ body: { email: longA } });
const hashedB = key({ body: { email: longB } });
assert.match(hashedA, /^h:[0-9a-f]{32}$/);
assert.notEqual(hashedA, hashedB, "distinct long values must not collide");
assert.ok(hashedA.length < 40);
assert.equal(key({ body: { email: longA.toUpperCase() } }), hashedA, "hashing happens after canonicalisation");

// --- unknown-field rejection -------------------------------------------

assert.doesNotThrow(() => validateKeys({ email: "a@b.c", password: "x" }, ["email", "password", "role"]));
assert.throws(() => validateKeys({ email: "a@b.c", isAdmin: true }, ["email", "password"]), /unsupported fields/);

// --- bounded map keys ---------------------------------------------------

assert.equal(boundedKey("  Mixed@Case.Edu "), "mixed@case.edu");
assert.equal(boundedKey("x".repeat(500), 254).length, 254);
assert.equal(boundedKey(undefined), "");

console.log("auth-hardening tests passed");
