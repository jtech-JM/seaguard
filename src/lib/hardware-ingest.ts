import { createHash, randomUUID } from "node:crypto";

const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;
const DEFAULT_RATE_LIMIT_MAX_REQUESTS = 30;

const rateLimitStore = new Map<string, { count: number; windowStart: number }>();

/** Device secrets are stored as SHA-256 hex digests; this derives the digest to compare. */
export function hashDeviceSecret(secret: string) {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

export function newTraceId() {
  return randomUUID();
}

/**
 * Best-effort in-process request throttle.
 *
 * IMPORTANT: this is per serverless instance, not global. On Vercel each cold
 * instance starts with an empty map and concurrent instances do not share
 * counters, so it bounds a single misbehaving connection but is NOT a defence
 * against a distributed flood. The real access control on these endpoints is the
 * per-device secret; durable throttling would need a shared store (see
 * DASHBOARD_FIX_TODO.md, Priority 2).
 */
export function checkRateLimit(
  key: string,
  limit = DEFAULT_RATE_LIMIT_MAX_REQUESTS,
  windowMs = DEFAULT_RATE_LIMIT_WINDOW_MS,
) {
  const now = Date.now();
  const entry = rateLimitStore.get(key);
  if (!entry || now - entry.windowStart >= windowMs) {
    rateLimitStore.set(key, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= limit) return false;
  entry.count += 1;
  return true;
}

/** Test seam — the limiter is module-level state shared across requests. */
export function resetRateLimits() {
  rateLimitStore.clear();
}
