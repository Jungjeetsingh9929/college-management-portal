export function requiredText(value, field, { min = 1, max = 160 } = {}) {
  const text = String(value ?? "").trim();
  if (text.length < min || text.length > max) {
    throw new Error(`${field} must be between ${min} and ${max} characters.`);
  }
  return text;
}

export function validPassword(value) {
  const password = String(value ?? "");
  return password.length >= 8 && password.length <= 200;
}

export function parseAnswerIndex(value, optionCount) {
  const index = Number(value);
  return Number.isInteger(index) && index >= 0 && index < optionCount ? index : null;
}