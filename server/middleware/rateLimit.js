const buckets = new Map();
const MAX_BUCKETS = Math.max(100, Number(process.env.RATE_LIMIT_MAX_BUCKETS) || 10000);
const CLEANUP_INTERVAL_MS = Math.max(1000, Number(process.env.RATE_LIMIT_CLEANUP_MS) || 60000);
let lastCleanup = 0;

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

export function rateLimit({ windowMs, limit, message, keyGenerator, backoffBaseMs = 0, backoffMaxMs = 0 }) {
  return (req, res, next) => {
    const now = Date.now();
    cleanup(now);
    const identity = keyGenerator ? keyGenerator(req) : clientKey(req);
    const key = `${req.baseUrl || ""}:${req.path}:${identity}`;
    const current = buckets.get(key);

    if (!current || current.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs, blockedUntil: 0 });
      return next();
    }

    if (current.blockedUntil > now) {
      res.set("Retry-After", String(Math.ceil((current.blockedUntil - now) / 1000)));
      return res.status(429).json({ message });
    }

    current.count += 1;
    if (current.count > limit) {
      const excess = current.count - limit;
      const delay = backoffBaseMs ? Math.min(backoffMaxMs || backoffBaseMs * 32, backoffBaseMs * (2 ** Math.min(excess - 1, 10))) : 0;
      current.blockedUntil = Math.min(current.resetAt, now + delay);
      res.set("Retry-After", String(Math.ceil(Math.max(current.blockedUntil - now, 1000) / 1000)));
      return res.status(429).json({ message });
    }

    next();
  };
}
