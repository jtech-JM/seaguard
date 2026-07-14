import { createHash } from "node:crypto";

const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;
const DEFAULT_RATE_LIMIT_MAX_REQUESTS = 30;
const REPLAY_GRACE_MS = 5_000;

const rateLimitStore = new Map<string, { count: number; windowStart: number }>();

export function hashDeviceSecret(secret: string) {
  return createHash("sha256").update(secret).digest("hex");
}

export function timingSafeEq(a: string, b: string) {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

export function checkRateLimit(key: string, limit = DEFAULT_RATE_LIMIT_MAX_REQUESTS, windowMs = DEFAULT_RATE_LIMIT_WINDOW_MS) {
  const now = Date.now();
  const entry = rateLimitStore.get(key);
  if (!entry || now - entry.windowStart >= windowMs) {
    rateLimitStore.set(key, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= limit) {
    return false;
  }
  entry.count += 1;
  return true;
}

export function isReplayAttempt(previousNonce: string | null, previousTimestamp: string | null, nonce: string, timestamp: string) {
  if (!previousNonce || !previousTimestamp) return false;
  const prevTime = new Date(previousTimestamp).getTime();
  if (Number.isNaN(prevTime)) return false;
  const now = Date.now();
  return previousNonce === nonce && now - prevTime <= REPLAY_GRACE_MS;
}
