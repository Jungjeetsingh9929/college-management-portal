export function requiredText(value, field, { min = 1, max = 160 } = {}) {
  if (typeof value !== "string") throw new Error(`${field} must be text.`);
  const text = value.trim();
  if (text.length < min || text.length > max) {
    throw new Error(`${field} must be between ${min} and ${max} characters.`);
  }
  return text;
}

export function validEmail(value) {
  return typeof value === "string" && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function validId(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(value);
}

export function validTime(value) {
  return typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function enumValue(value, field, values) {
  if (typeof value !== "string" || !values.includes(value)) throw new Error(`${field} is invalid.`);
  return value;
}

export function validPassword(value) {
  return typeof value === "string" && value.length >= 12 && value.length <= 200 && /[a-z]/.test(value) && /[A-Z]/.test(value) && /\d/.test(value) && /[^A-Za-z0-9\s]/.test(value);
}

export const PASSWORD_REQUIREMENTS = "Password must be 12-200 characters and include upper-case, lower-case, numeric, and symbol characters.";

// Used where an ALREADY-STORED password is being presented (login, and the
// `currentPassword` of a change-password request). validPassword() is the
// policy for a password being *set*; applying it to a password being
// *checked* meant any account whose hash predates the current policy was
// rejected at login with "Invalid email, password, or role." and, because
// change-password applied the same test to currentPassword, could never
// rotate to a compliant password either - a permanent lockout that looks
// like a wrong password. The real gate is still the bcrypt comparison; this
// only bounds the input so an oversized value never reaches it.
export function validExistingPassword(value) {
  return typeof value === "string" && value.length >= 1 && value.length <= 200;
}

// Trims, lower-cases and bounds a value that will be used as a rate-limit
// bucket key or a map key. Unbounded attacker-controlled keys let a single
// client mint a new bucket per request (defeating the limit) and grow the
// bucket map/table without limit.
export function boundedKey(value, max = 160) {
  return String(value ?? "").trim().toLowerCase().slice(0, max);
}

export function parseAnswerIndex(value, optionCount) {
  const index = Number(value);
  return Number.isInteger(index) && index >= 0 && index < optionCount ? index : null;
}

export function validateKeys(body, allowed) {
  const unknown = Object.keys(body).filter((key) => !allowed.includes(key));
  if (unknown.length) throw new Error("Request contains unsupported fields.");
}
