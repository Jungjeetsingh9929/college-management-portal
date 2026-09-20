// Single source of truth for "where does the browser-facing client live?".
//
// This value feeds two very different consumers:
//   1. CORS (server/index.js) - a wrong value here fails loudly and
//      immediately: the browser blocks the request and someone notices.
//   2. The attendance QR check-in URL (server/routes/attendance.js) - a wrong
//      value here used to fail *silently*: the QR still rendered, still
//      scanned, and only died on the student's phone at a URL nobody on the
//      teacher's side ever sees.
//
// Two things close that gap:
//   - validateClientOrigins() runs at startup and refuses to boot in
//     production on a missing/unparseable/loopback origin, so the bad config
//     is caught before a single QR is printed.
//   - The QR URL itself is now built from a relative path on the client
//     (see qrCheckInUrl / qrPath in routes/attendance.js), so the scannable
//     link is anchored to the origin the teacher's browser is *actually*
//     on and cannot inherit a stale env var at all.

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"]);

export const CLIENT_ORIGIN_DEFAULT = "http://localhost:5175,http://127.0.0.1:5175";

function rawClientOriginSetting() {
  const explicit = String(process.env.CLIENT_ORIGIN || "").trim();
  if (explicit) return { value: explicit, key: "CLIENT_ORIGIN" };
  const fallback = String(process.env.FRONTEND_URL || "").trim();
  if (fallback) return { value: fallback, key: "FRONTEND_URL" };
  return { value: "", key: null };
}

// Parses one entry into a bare origin ("https://portal.example.edu"), or
// returns a reason it can't be used. Anything with a path, query or fragment
// is rejected rather than silently trimmed - "https://example.edu/app" as an
// origin is almost always a misunderstanding of what the variable does, and
// quietly dropping "/app" would produce exactly the dead QR link this is
// meant to prevent.
function parseOrigin(entry) {
  let url;
  try {
    url = new URL(entry);
  } catch {
    return { error: `"${entry}" is not an absolute URL (expected something like https://portal.example.edu).` };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { error: `"${entry}" must use http:// or https://, not ${url.protocol}//.` };
  }
  if ((url.pathname && url.pathname !== "/") || url.search || url.hash) {
    return { error: `"${entry}" must be a bare origin with no path, query or fragment (use ${url.origin}).` };
  }
  if (url.username || url.password) {
    return { error: `"${entry}" must not contain credentials.` };
  }
  return { origin: url.origin, isLoopback: LOOPBACK_HOSTS.has(url.hostname), isInsecure: url.protocol === "http:" };
}

// Every configured origin, normalized and de-duplicated. Invalid entries are
// dropped here (validateClientOrigins() is what reports them) so a single
// typo in a comma-separated list can't take down CORS for the good entries.
export function configuredClientOrigins() {
  const { value } = rawClientOriginSetting();
  const source = value || CLIENT_ORIGIN_DEFAULT;
  const origins = [];
  for (const entry of source.split(",").map((i) => i.trim()).filter(Boolean)) {
    const parsed = parseOrigin(entry);
    if (parsed.origin && !origins.includes(parsed.origin)) origins.push(parsed.origin);
  }
  return origins;
}

// The origin to use when the server has to name the client itself (QR
// fallback, email links). First configured entry wins.
export function primaryClientOrigin() {
  return configuredClientOrigins()[0] || "";
}

// Startup check. Returns { fatal: [], warnings: [] } - index.js decides what
// to do with them, which keeps this module import-safe for tests.
export function validateClientOrigins({ isProduction = process.env.NODE_ENV === "production" } = {}) {
  const { value, key } = rawClientOriginSetting();
  const fatal = [];
  const warnings = [];

  if (!value) {
    const message =
      "CLIENT_ORIGIN (or FRONTEND_URL) is not set. It defines the public origin students' attendance QR links and password-reset emails point at.";
    if (isProduction) fatal.push(`${message} Set it to your deployed site origin, e.g. https://portal.example.edu.`);
    else warnings.push(`${message} Falling back to ${CLIENT_ORIGIN_DEFAULT} for local development.`);
    return { fatal, warnings };
  }

  const entries = value.split(",").map((i) => i.trim()).filter(Boolean);
  for (const entry of entries) {
    const parsed = parseOrigin(entry);
    if (parsed.error) {
      (isProduction ? fatal : warnings).push(`${key} is invalid: ${parsed.error}`);
      continue;
    }
    if (parsed.isLoopback && isProduction) {
      fatal.push(
        `${key} points at a loopback address (${parsed.origin}). In production this would bake an unreachable URL into every attendance QR code. Set it to the origin students actually browse to.`
      );
    }
    if (parsed.isInsecure && !parsed.isLoopback && isProduction) {
      warnings.push(`${key} uses plain http (${parsed.origin}); attendance QR links and reset emails will be sent over an insecure origin.`);
    }
  }
  return { fatal, warnings };
}

// Best-effort absolute origin for a given request, used only where an
// absolute URL is genuinely required (share text, non-browser API clients).
// `source` is returned so callers can surface *why* a URL looks the way it
// does instead of leaving it a mystery.
export function resolveClientOrigin(req) {
  // Only an *explicitly configured* origin is authoritative here. When
  // nothing is set the built-in localhost default is a dev convenience, not
  // a statement about where the client lives, so the request's own
  // Referer/host is the better guess (a dev running Vite on a non-default
  // port, for instance).
  const { key } = rawClientOriginSetting();
  const configured = key ? primaryClientOrigin() : "";
  if (configured) return { origin: configured, source: key };

  const referer = req?.get?.("referer") || req?.get?.("origin");
  if (referer) {
    try {
      return { origin: new URL(referer).origin, source: "request-referer" };
    } catch {
      /* fall through */
    }
  }
  return { origin: `${req.protocol}://${req.get("host")}`, source: "request-host" };
}
