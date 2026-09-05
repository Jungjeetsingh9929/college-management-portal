const buckets = new Map();

function clientKey(req) {
  return req.ip || req.socket.remoteAddress || "unknown";
}

export function rateLimit({ windowMs, limit, message }) {
  return (req, res, next) => {
    const now = Date.now();
    const key = `${req.baseUrl || ""}:${req.path}:${clientKey(req)}`;
    const current = buckets.get(key);

    if (!current || current.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    current.count += 1;
    if (current.count > limit) {
      res.set("Retry-After", String(Math.ceil((current.resetAt - now) / 1000)));
      return res.status(429).json({ message });
    }

    next();
  };
}