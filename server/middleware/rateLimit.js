import { pool, usePostgres } from "../db/fileStore.js";

// In-memory backend: used in dev/test (no DATABASE_URL). Fine for a single
// process, but each Render instance would keep its own independent counters
// if this were used in production with more than one instance.
const buckets = new Map();
const MAX_BUCKETS = Math.max(100, Number(process.env.RATE_LIMIT_MAX_BUCKETS) || 10000);
const CLEANUP_INTERVAL_MS = Math.max(1000, Number(process.env.RATE_LIMIT_CLEANUP_MS) || 60000);
let lastCleanup = 0;
let lastPgCleanup = 0;

function cleanup(now) {
  if (now - lastCleanup < CLEANUP_INTERVAL_MS && buckets.size <= MAX_BUCKETS) return;
  lastCleanup = now;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now && bucket.blockedUntil <= now) buckets.delete(key);
  }
  if (buckets.size > MAX_BUCKETS) {
    const entries = [...buckets.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt);
    for (let index = 0; buckets.size > MAX_BUCKETS && index < entries.length; index += 1) {
      buckets.delete(entries[index][0]);
    }
  }
}

// Postgres backend: used whenever DATABASE_URL is set (production), so
// counters are shared and enforced correctly across every Render instance
// instead of each instance tracking its own count in memory.
function maybeCleanupPg(now) {
  if (now - lastPgCleanup < CLEANUP_INTERVAL_MS) return;
  lastPgCleanup = now;
  pool
    .query(`DELETE FROM college_portal_rate_limits WHERE reset_at <= now() AND blocked_until <= now()`)
    .catch((error) => console.error("Rate limit cleanup failed:", error));
}

async function checkPg(key, windowMs, limit, backoffBaseMs, backoffMaxMs) {
  const now = Date.now();
  maybeCleanupPg(now);
  const result = await pool.query(
    `INSERT INTO college_portal_rate_limits (key, count, reset_at, blocked_until)
     VALUES ($1, 1, now() + ($2::text || ' milliseconds')::interval, to_timestamp(0))
     ON CONFLICT (key) DO UPDATE SET
       count = CASE WHEN college_portal_rate_limits.reset_at <= now() THEN 1 ELSE college_portal_rate_limits.count + 1 END,
       reset_at = CASE WHEN college_portal_rate_limits.reset_at <= now() THEN now() + ($2::text || ' milliseconds')::interval ELSE college_portal_rate_limits.reset_at END,
       blocked_until = CASE WHEN college_portal_rate_limits.reset_at <= now() THEN to_timestamp(0) ELSE college_portal_rate_limits.blocked_until END
     RETURNING count, reset_at, blocked_until`,
    [key, windowMs]
  );
  const row = result.rows[0];
  const blockedUntilMs = row.blocked_until.getTime();
  if (blockedUntilMs > now) {
    return { allowed: false, retryAfterMs: blockedUntilMs - now };
  }
  if (row.count > limit) {
    const excess = row.count - limit;
    const delay = backoffBaseMs ? Math.min(backoffMaxMs || backoffBaseMs * 32, backoffBaseMs * (2 ** Math.min(excess - 1, 10))) : 0;
    const resetAtMs = row.reset_at.getTime();
    const newBlockedUntil = Math.min(resetAtMs, now + delay);
    await pool.query(`UPDATE college_portal_rate_limits SET blocked_until = to_timestamp($2 / 1000.0) WHERE key = $1`, [key, newBlockedUntil]);
    return { allowed: false, retryAfterMs: Math.max(newBlockedUntil - now, 1000) };
  }
  return { allowed: true };
}

function envNumber(name, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

export function clientKey(req) {
  return req.ip || req.socket.remoteAddress || "unknown";
}

export function rateConfig(prefix, defaults) {
  return {
    windowMs: envNumber(`${prefix}_WINDOW_MS`, defaults.windowMs, { min: 1000 }),
    limit: envNumber(`${prefix}_LIMIT`, defaults.limit, { min: 1 }),
    backoffBaseMs: envNumber(`${prefix}_BACKOFF_BASE_MS`, defaults.backoffBaseMs || 0, { min: 0 }),
    backoffMaxMs: envNumber(`${prefix}_BACKOFF_MAX_MS`, defaults.backoffMaxMs || 0, { min: 0 })
  };
}

function checkMemory(key, windowMs, limit, backoffBaseMs, backoffMaxMs) {
  const now = Date.now();
  cleanup(now);
  const current = buckets.get(key);

  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs, blockedUntil: 0 });
    return { allowed: true };
  }

  if (current.blockedUntil > now) {
    return { allowed: false, retryAfterMs: current.blockedUntil - now };
  }

  current.count += 1;
  if (current.count > limit) {
    const excess = current.count - limit;
    const delay = backoffBaseMs ? Math.min(backoffMaxMs || backoffBaseMs * 32, backoffBaseMs * (2 ** Math.min(excess - 1, 10))) : 0;
    current.blockedUntil = Math.min(current.resetAt, now + delay);
    return { allowed: false, retryAfterMs: Math.max(current.blockedUntil - now, 1000) };
  }

  return { allowed: true };
}

export function rateLimit({ windowMs, limit, message, keyGenerator, backoffBaseMs = 0, backoffMaxMs = 0 }) {
  return (req, res, next) => {
    const identity = keyGenerator ? keyGenerator(req) : clientKey(req);
    const key = `${req.baseUrl || ""}:${req.path}:${identity}`;

    const respond = ({ allowed, retryAfterMs }) => {
      if (allowed) return next();
      res.set("Retry-After", String(Math.ceil(retryAfterMs / 1000)));
      return res.status(429).json({ message });
    };

    if (!usePostgres) return respond(checkMemory(key, windowMs, limit, backoffBaseMs, backoffMaxMs));

    // Fail open on a database error rather than taking the whole API down
    // if the rate-limit table is briefly unreachable - the same tradeoff
    // the rest of the app makes for non-critical background work (e.g.
    // audit logging).
    checkPg(key, windowMs, limit, backoffBaseMs, backoffMaxMs)
      .then(respond)
      .catch((error) => {
        console.error("Postgres rate limit check failed, allowing request:", error);
        next();
      });
  };
}
