import { createHash } from "node:crypto";

// Builds a bucket key from an attacker-controlled body field (the login email, for example). Two things matter here: * it must be *bounded* - the raw value could be almost the whole 100kb JSON body.
export function bodyFieldKey(field, { max = 120 } = {}) {
  return (req) => {
    const raw = String(req.body?.[field] ?? "").trim().toLowerCase();
    if (!raw) return "unknown";
    if (raw.length <= max) return raw;
    return `h:${createHash("sha256").update(raw).digest("hex").slice(0, 32)}`;
  };
}
