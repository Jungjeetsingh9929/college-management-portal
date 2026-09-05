const buckets = new Map();

export function clientKey(req) {
  return req.ip || req.socket.remoteAddress || "unknown";
}

// By default, requests are bucketed per source IP. That's correct for
// pre-login routes (no user identity yet), but for authenticated routes it
// means students on the same campus WiFi/NAT share one IP and one bucket -
// so the first few students to submit can exhaust the limit and lock out
// everyone else behind the same IP for the rest of the window. Pass
// `keyGenerator` to bucket by student identity instead (falling back to IP
// if, for any reason, req.user isn't set).
export function rateLimit({ windowMs, limit, message, keyGenerator }) {
  return (req, res, next) => {
    const now = Date.now();
    const identity = keyGenerator ? keyGenerator(req) : clientKey(req);
    const key = `${req.baseUrl || ""}:${req.path}:${identity}`;
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