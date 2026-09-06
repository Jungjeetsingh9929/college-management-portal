export function requiredText(value, field, { min = 1, max = 160 } = {}) {
  if (typeof value !== "string") throw new Error(`${field} must be text.`);
  const text = value.trim();
  if (text.length < min || text.length > max) {
    throw new Error(`${field} must be between ${min} and ${max} characters.`);
  }
  return text;
}

export function optionalText(value, field, { max = 160 } = {}) {
  if (value === undefined || value === null || value === "") return "";
  return requiredText(value, field, { min: 0, max });
}

export function requestObject(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Request body must be an object.");
  return body;
}

export function validEmail(value) {
  return typeof value === "string" && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function validId(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(value);
}

export function validDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

export function validTime(value) {
  return typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function enumValue(value, field, values) {
  if (typeof value !== "string" || !values.includes(value)) throw new Error(`${field} is invalid.`);
  return value;
}

export function validPassword(value) {
  return typeof value === "string" && value.length >= 12 && value.length <= 200;
}

export const PASSWORD_REQUIREMENTS = "Password must be between 12 and 200 characters.";

export function parseAnswerIndex(value, optionCount) {
  const index = Number(value);
  return Number.isInteger(index) && index >= 0 && index < optionCount ? index : null;
}

export function validateKeys(body, allowed) {
  const unknown = Object.keys(body).filter((key) => !allowed.includes(key));
  if (unknown.length) throw new Error("Request contains unsupported fields.");
}
