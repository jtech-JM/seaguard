import { createHash, randomUUID } from "node:crypto";

const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;
const DEFAULT_RATE_LIMIT_MAX_REQUESTS = 30;

/**
 * Ceiling on tracked keys. Without one the map is a slow memory leak: a key is
 * added per distinct source address and, before this, none were ever removed.
 */
const MAX_TRACKED_KEYS = 10_000;

const rateLimitStore = new Map<string, { count: number; windowStart: number }>();

/** Drop every window that has already expired. */
function evictExpired(now: number, windowMs: number) {
  for (const [key, entry] of rateLimitStore) {
    if (now - entry.windowStart >= windowMs) rateLimitStore.delete(key);
  }
}

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
 * IMPORTANT: this is per instance, not global. Each cold start begins with an
 * empty map and concurrent instances do not share counters, so it bounds a
 * single misbehaving connection but is NOT a defence against a distributed
 * flood. The real access control on these endpoints is the per-device secret;
 * durable throttling would need a shared store (see DASHBOARD_FIX_TODO.md,
 * Priority 2).
 *
 * Tracked keys are bounded and expired windows are reclaimed, so a long-lived
 * instance seeing many distinct addresses cannot grow the map without limit.
 */
export function checkRateLimit(
  key: string,
  limit = DEFAULT_RATE_LIMIT_MAX_REQUESTS,
  windowMs = DEFAULT_RATE_LIMIT_WINDOW_MS,
) {
  const now = Date.now();
  const entry = rateLimitStore.get(key);
  if (!entry || now - entry.windowStart >= windowMs) {
    if (rateLimitStore.size >= MAX_TRACKED_KEYS) {
      evictExpired(now, windowMs);
      // Still full: every tracked window is live, so this is a flood of distinct
      // keys. Evict the oldest rather than refuse the newcomer — a 429 here
      // would fall on whichever device happened to arrive during the flood, and
      // dropping a distress call to protect a best-effort counter is the wrong
      // trade. The per-device secret is the real access control.
      if (rateLimitStore.size >= MAX_TRACKED_KEYS) {
        const overflow = Math.ceil(MAX_TRACKED_KEYS / 10);
        let dropped = 0;
        for (const oldest of rateLimitStore.keys()) {
          rateLimitStore.delete(oldest);
          if (++dropped >= overflow) break;
        }
      }
    }
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

/** Test seam — lets the bounding behaviour be asserted without exporting the map. */
export function trackedRateLimitKeys() {
  return rateLimitStore.size;
}

export const RATE_LIMIT_KEY_CEILING = MAX_TRACKED_KEYS;
