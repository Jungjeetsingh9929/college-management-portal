// Validation for the student self-service profile (PUT /api/students/me/profile).
//
// Pure module: no database, no Express, no imports from other feature code, so
// it can be unit-tested on its own and cannot pull later modules into Phase 1.
// The client keeps a mirrored copy in client/src/utils/profileValidation.js;
// keep the two in sync when a rule changes.

export const PROFILE_FIELDS = [
  "phone", "guardian", "bio", "skills", "linkedin", "github",
  "emergencyContactName", "emergencyContactPhone"
];

export const PROFILE_LIMITS = {
  phone: 120, guardian: 120, bio: 300, skillCount: 10, skillLength: 30,
  url: 200, emergencyContactName: 80, emergencyContactPhone: 20
};

const PROFILE_HOSTS = { linkedin: "linkedin.com", github: "github.com" };

// C0/C1 control characters other than tab/newline never belong in profile text.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/;
const PHONE_CHARS = /^[0-9+\- ]+$/;

class ProfileError extends Error {
  constructor(field, message) { super(message); this.field = field; }
}

function text(value, field, label, max, { multiline = false } = {}) {
  if (typeof value !== "string") throw new ProfileError(field, `${label} must be text.`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new ProfileError(field, `${label} must be at most ${max} characters.`);
  if (CONTROL.test(trimmed) || (!multiline && /[\r\n\t]/.test(trimmed))) {
    throw new ProfileError(field, `${label} contains unsupported characters.`);
  }
  return trimmed;
}

// Returns the normalised href for a valid https URL on `domain` (or one of its
// subdomains), or null. Exact-suffix matching on the parsed hostname means
// "evil-github.com" and "github.com.evil.io" are both rejected.
export function safeProfileUrl(value, kind) {
  const domain = PROFILE_HOSTS[kind];
  if (!domain || typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw || raw.length > PROFILE_LIMITS.url || /\s/.test(raw) || CONTROL.test(raw)) return null;
  let url;
  try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== "https:") return null;
  if (url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase();
  if (host !== domain && !host.endsWith(`.${domain}`)) return null;
  return url.href;
}

// Validates a request body. Returns { updates } on success or { field, message }
// on failure. Never throws for bad input.
export function validateProfileUpdate(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { field: null, message: "Invalid profile data." };
  const keys = Object.keys(body);
  const unknown = keys.filter((key) => !PROFILE_FIELDS.includes(key));
  if (unknown.length) return { field: null, message: "Request contains unsupported fields." };
  if (!keys.length) return { field: null, message: "No profile fields were provided." };

  const updates = {};
  try {
    for (const key of keys) {
      const value = body[key];
      switch (key) {
        case "phone": updates.phone = text(value, key, "Phone", PROFILE_LIMITS.phone); break;
        case "guardian": updates.guardian = text(value, key, "Guardian", PROFILE_LIMITS.guardian); break;
        case "bio": updates.bio = text(value, key, "Bio", PROFILE_LIMITS.bio, { multiline: true }); break;
        case "emergencyContactName":
          updates.emergencyContactName = text(value, key, "Emergency contact name", PROFILE_LIMITS.emergencyContactName);
          break;
        case "emergencyContactPhone": {
          const phone = text(value, key, "Emergency contact phone", PROFILE_LIMITS.emergencyContactPhone);
          if (phone && (!PHONE_CHARS.test(phone) || !/\d/.test(phone))) {
            throw new ProfileError(key, "Emergency contact phone may only contain digits, +, spaces, and dashes.");
          }
          updates.emergencyContactPhone = phone;
          break;
        }
        case "linkedin":
        case "github": {
          const raw = text(value, key, key === "github" ? "GitHub link" : "LinkedIn link", PROFILE_LIMITS.url);
          if (raw === "") { updates[key] = ""; break; }
          const href = safeProfileUrl(raw, key);
          if (!href) {
            throw new ProfileError(key, `${key === "github" ? "GitHub" : "LinkedIn"} link must be an https URL on ${PROFILE_HOSTS[key]}.`);
          }
          updates[key] = href;
          break;
        }
        case "skills": {
          if (!Array.isArray(value)) throw new ProfileError(key, "Skills must be a list.");
          if (value.length > PROFILE_LIMITS.skillCount) throw new ProfileError(key, `You can add at most ${PROFILE_LIMITS.skillCount} skills.`);
          const seen = new Set();
          const skills = [];
          for (const item of value) {
            const skill = text(item, key, "Each skill", PROFILE_LIMITS.skillLength);
            if (!skill) throw new ProfileError(key, "Skills cannot be empty.");
            const dedupeKey = skill.toLowerCase();
            if (seen.has(dedupeKey)) continue;
            seen.add(dedupeKey);
            skills.push(skill);
          }
          updates.skills = skills;
          break;
        }
        default: break;
      }
    }
  } catch (error) {
    if (error instanceof ProfileError) return { field: error.field, message: error.message };
    throw error;
  }
  return { updates };
}
