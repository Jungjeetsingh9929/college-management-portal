// Covers the config that decides where attendance QR codes point.
// Deliberately dependency-free (no express/db boot) so it stays fast and can
// run before the rest of the suite.
import assert from "node:assert/strict";

const modulePath = "../server/config/clientOrigin.js";

// Each case re-imports the module with a cache-busting query so the env is
// read fresh - the helpers read process.env at call time, but this also
// guards against anyone caching the parsed value later.
async function withEnv(value, fn) {
  const previous = { client: process.env.CLIENT_ORIGIN, frontend: process.env.FRONTEND_URL };
  delete process.env.CLIENT_ORIGIN;
  delete process.env.FRONTEND_URL;
  if (value !== undefined) process.env.CLIENT_ORIGIN = value;
  try {
    const mod = await import(`${modulePath}?case=${encodeURIComponent(String(value))}`);
    await fn(mod);
  } finally {
    if (previous.client === undefined) delete process.env.CLIENT_ORIGIN;
    else process.env.CLIENT_ORIGIN = previous.client;
    if (previous.frontend === undefined) delete process.env.FRONTEND_URL;
    else process.env.FRONTEND_URL = previous.frontend;
  }
}

// A valid origin is normalized (trailing slash dropped) and passes in prod.
await withEnv("https://portal.example.edu/", ({ configuredClientOrigins, primaryClientOrigin, validateClientOrigins }) => {
  assert.deepEqual(configuredClientOrigins(), ["https://portal.example.edu"]);
  assert.equal(primaryClientOrigin(), "https://portal.example.edu");
  assert.deepEqual(validateClientOrigins({ isProduction: true }).fatal, []);
});

// The failure this whole change exists to stop: a loopback origin in
// production would bake an unreachable host into every QR code.
await withEnv("http://localhost:5175", ({ validateClientOrigins }) => {
  assert.equal(validateClientOrigins({ isProduction: true }).fatal.length, 1);
  assert.equal(validateClientOrigins({ isProduction: false }).fatal.length, 0, "must never block local development");
});

// An origin with a path is rejected rather than silently truncated.
await withEnv("https://portal.example.edu/app", ({ validateClientOrigins }) => {
  assert.match(validateClientOrigins({ isProduction: true }).fatal[0], /bare origin/);
});

await withEnv("portal.example.edu", ({ validateClientOrigins }) => {
  assert.match(validateClientOrigins({ isProduction: true }).fatal[0], /absolute URL/);
});

// Unset in production is fatal; unset in development is a warning.
await withEnv(undefined, ({ validateClientOrigins }) => {
  assert.equal(validateClientOrigins({ isProduction: true }).fatal.length, 1);
  const dev = validateClientOrigins({ isProduction: false });
  assert.equal(dev.fatal.length, 0);
  assert.equal(dev.warnings.length, 1);
});

// One bad entry must not take CORS down for the good ones, and duplicates
// collapse.
await withEnv("https://a.example.edu, not-a-url ,https://a.example.edu,https://b.example.edu", ({ configuredClientOrigins }) => {
  assert.deepEqual(configuredClientOrigins(), ["https://a.example.edu", "https://b.example.edu"]);
});

// With nothing configured, the built-in localhost default is a dev
// convenience only - the request's own Referer wins.
await withEnv(undefined, ({ resolveClientOrigin }) => {
  const req = { get: (header) => (header === "referer" ? "https://real.example.edu/dashboard?x=1" : null), protocol: "https" };
  assert.deepEqual(resolveClientOrigin(req), { origin: "https://real.example.edu", source: "request-referer" });
});

// An explicit setting overrides the Referer.
await withEnv("https://portal.example.edu", ({ resolveClientOrigin }) => {
  const req = { get: (header) => (header === "referer" ? "https://someone-elses-host.test/" : null), protocol: "https" };
  assert.equal(resolveClientOrigin(req).origin, "https://portal.example.edu");
});

console.log("client-origin tests passed");
