import { createHash } from "node:crypto";

// Builds a bucket key from an attacker-controlled body field (the login
// email, for example). Two things matter here:
//   * it must be *bounded* - the raw value could be almost the whole 100kb
//     JSON body, and every distinct value is a new row in the in-memory Map
//     or the Postgres rate-limit table;
//   * it must be *canonical* - "A@x.com", " a@x.com " and "a@X.com" all sign
//     in to the same account, so they must share one bucket or the
//     per-account limit is bypassed by re-casing the address.
// Values longer than `max` are hashed rather than truncated, so two long
// addresses sharing a prefix don't collide into one bucket.
export function bodyFieldKey(field, { max = 120 } = {}) {
  return (req) => {
    const raw = String(req.body?.[field] ?? "").trim().toLowerCase();
    if (!raw) return "unknown";
    if (raw.length <= max) return raw;
    return `h:${createHash("sha256").update(raw).digest("hex").slice(0, 32)}`;
  };
}
