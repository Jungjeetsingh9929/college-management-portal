// Client-side mirror of server/services/profileValidation.js (Phase 1 student
// profile). The server is the source of truth; this only gives instant
// feedback and gates which saved links are safe to render as anchors.

export const PROFILE_LIMITS = {
  phone: 120, guardian: 120, bio: 300, skillCount: 10, skillLength: 30,
  url: 200, emergencyContactName: 80, emergencyContactPhone: 20
};

const HOSTS = { linkedin: "linkedin.com", github: "github.com" };
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/;

// Returns the normalised https href for a URL on the given site, else null.
export function safeProfileUrl(value, kind) {
  const domain = HOSTS[kind];
  if (!domain || typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw || raw.length > PROFILE_LIMITS.url || /\s/.test(raw) || CONTROL.test(raw)) return null;
  let url;
  try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase();
  if (host !== domain && !host.endsWith(`.${domain}`)) return null;
  return url.href;
}

// Draft <-> record helpers. Older student records have none of the new fields.
export function draftFromUser(user = {}) {
  return {
    phone: typeof user.phone === "string" ? user.phone : "",
    guardian: typeof user.guardian === "string" ? user.guardian : "",
    bio: typeof user.bio === "string" ? user.bio : "",
    skills: Array.isArray(user.skills) ? user.skills.filter((item) => typeof item === "string") : [],
    linkedin: typeof user.linkedin === "string" ? user.linkedin : "",
    github: typeof user.github === "string" ? user.github : "",
    emergencyContactName: typeof user.emergencyContactName === "string" ? user.emergencyContactName : "",
    emergencyContactPhone: typeof user.emergencyContactPhone === "string" ? user.emergencyContactPhone : ""
  };
}

export function normaliseSkills(skills) {
  const seen = new Set();
  const out = [];
  for (const item of skills) {
    const skill = String(item).trim();
    const key = skill.toLowerCase();
    if (!skill || seen.has(key)) continue;
    seen.add(key);
    out.push(skill);
  }
  return out;
}

export function draftPayload(draft) {
  return {
    phone: draft.phone.trim(),
    guardian: draft.guardian.trim(),
    bio: draft.bio.trim(),
    skills: normaliseSkills(draft.skills),
    linkedin: draft.linkedin.trim(),
    github: draft.github.trim(),
    emergencyContactName: draft.emergencyContactName.trim(),
    emergencyContactPhone: draft.emergencyContactPhone.trim()
  };
}

// Returns { field: message } for every invalid field (empty object = valid).
export function validateDraft(draft) {
  const errors = {};
  const p = draftPayload(draft);
  if (p.phone.length > PROFILE_LIMITS.phone) errors.phone = `Phone must be at most ${PROFILE_LIMITS.phone} characters.`;
  if (p.guardian.length > PROFILE_LIMITS.guardian) errors.guardian = `Guardian must be at most ${PROFILE_LIMITS.guardian} characters.`;
  if (p.bio.length > PROFILE_LIMITS.bio) errors.bio = `Bio must be at most ${PROFILE_LIMITS.bio} characters.`;
  if (draft.skills.length > PROFILE_LIMITS.skillCount) errors.skills = `You can add at most ${PROFILE_LIMITS.skillCount} skills.`;
  else if (draft.skills.some((skill) => String(skill).trim().length > PROFILE_LIMITS.skillLength)) errors.skills = `Each skill must be at most ${PROFILE_LIMITS.skillLength} characters.`;
  for (const kind of ["linkedin", "github"]) {
    if (p[kind] && !safeProfileUrl(p[kind], kind)) errors[kind] = `Enter a full https:// link on ${HOSTS[kind]}.`;
  }
  if (p.emergencyContactName.length > PROFILE_LIMITS.emergencyContactName) errors.emergencyContactName = `Name must be at most ${PROFILE_LIMITS.emergencyContactName} characters.`;
  const ep = p.emergencyContactPhone;
  if (ep.length > PROFILE_LIMITS.emergencyContactPhone) errors.emergencyContactPhone = `Phone must be at most ${PROFILE_LIMITS.emergencyContactPhone} characters.`;
  else if (ep && (!/^[0-9+\- ]+$/.test(ep) || !/\d/.test(ep))) errors.emergencyContactPhone = "Use only digits, +, spaces, and dashes.";
  return errors;
}

// Completeness is computed from the *saved* record plus the approved-photo
// state, so it only moves after a successful save/upload.
export function profileCompleteness(user = {}, hasApprovedPhoto = false) {
  const saved = draftFromUser(user);
  const items = [
    ["Approved photo", Boolean(hasApprovedPhoto)],
    ["Phone", saved.phone.trim() !== ""],
    ["Guardian", saved.guardian.trim() !== ""],
    ["Bio", saved.bio.trim() !== ""],
    ["Skills", saved.skills.length > 0],
    ["Emergency contact", saved.emergencyContactName.trim() !== "" && saved.emergencyContactPhone.trim() !== ""]
  ].map(([label, done]) => ({ label, done }));
  const doneCount = items.filter((item) => item.done).length;
  return { items, percent: Math.round((doneCount / items.length) * 100) };
}

// Adds one or more skills (comma-separated input) to the list. Returns the new
// list, or { error } and the untouched list when the input can't be accepted.
export function addSkills(current, raw) {
  const parts = String(raw || "").split(",").map((part) => part.trim()).filter(Boolean);
  let skills = [...current];
  for (const part of parts) {
    if (part.length > PROFILE_LIMITS.skillLength) return { skills: current, error: `Each skill must be at most ${PROFILE_LIMITS.skillLength} characters.` };
    if (skills.some((skill) => skill.toLowerCase() === part.toLowerCase())) continue;
    if (skills.length >= PROFILE_LIMITS.skillCount) return { skills: current, error: `You can add at most ${PROFILE_LIMITS.skillCount} skills.` };
    skills = [...skills, part];
  }
  return { skills, error: "" };
}
