/**
 * Throttle-keying and memory-bounding for the public ingest endpoints.
 *
 * Both halves matter for availability rather than for correctness of a single
 * request: a throttle key the caller controls is no throttle at all, and a
 * counter map that only grows takes the instance down eventually.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { clientIp } from "./ingest-core";
import {
  RATE_LIMIT_KEY_CEILING,
  checkRateLimit,
  resetRateLimits,
  trackedRateLimitKeys,
} from "./hardware-ingest";

function req(headers: Record<string, string>) {
  return new Request("https://seaguard.test/api/public/ingest/sos", { method: "POST", headers });
}

// ── Throttle key ────────────────────────────────────────────────────────────

test("clientIp prefers the edge-set header over anything the caller sent", () => {
  assert.equal(
    clientIp(
      req({
        "cf-connecting-ip": "203.0.113.7",
        "x-real-ip": "198.51.100.4",
        "x-forwarded-for": "1.1.1.1, 2.2.2.2",
      }),
    ),
    "203.0.113.7",
  );
});

test("clientIp falls back to x-real-ip when there is no Cloudflare header", () => {
  assert.equal(
    clientIp(req({ "x-real-ip": "198.51.100.4", "x-forwarded-for": "1.1.1.1" })),
    "198.51.100.4",
  );
});

test("clientIp takes the rightmost forwarded hop, not the caller-supplied leftmost", () => {
  // An attacker prepends entries to mint a fresh throttle budget per request.
  // The rightmost hop is the one appended nearest to us.
  assert.equal(
    clientIp(req({ "x-forwarded-for": "9.9.9.9, 8.8.8.8, 203.0.113.7" })),
    "203.0.113.7",
  );
  assert.equal(clientIp(req({ "x-forwarded-for": "203.0.113.7" })), "203.0.113.7");
});

test("clientIp does not let a spoofed prefix change the throttle key", () => {
  const keys = new Set(
    ["evil-1", "evil-2", "evil-3"].map((spoof) =>
      clientIp(req({ "x-forwarded-for": `${spoof}, 203.0.113.7` })),
    ),
  );
  assert.deepEqual([...keys], ["203.0.113.7"], "all three requests must share one budget");
});

test("clientIp degrades to a constant when no address header is present", () => {
  assert.equal(clientIp(req({})), "unknown");
  assert.equal(clientIp(req({ "x-forwarded-for": "  ,  " })), "unknown");
  assert.equal(clientIp(req({ "cf-connecting-ip": "   " })), "unknown");
});

// ── Memory bounding ─────────────────────────────────────────────────────────

test("expired windows are reclaimed instead of accumulating", () => {
  resetRateLimits();
  // A 1ms window so every key is already stale by the time the ceiling is hit.
  for (let i = 0; i < RATE_LIMIT_KEY_CEILING + 500; i++) {
    checkRateLimit(`ip-${i}`, 30, 1);
  }
  assert.ok(
    trackedRateLimitKeys() < RATE_LIMIT_KEY_CEILING,
    `expected reclaim below the ceiling, tracked ${trackedRateLimitKeys()}`,
  );
  resetRateLimits();
});

test("a flood of distinct live keys stays bounded", () => {
  resetRateLimits();
  // A long window, so nothing expires and only the overflow eviction can cap it.
  const overflow = RATE_LIMIT_KEY_CEILING + 2_000;
  for (let i = 0; i < overflow; i++) {
    checkRateLimit(`flood-${i}`, 30, 60_000);
  }
  assert.ok(
    trackedRateLimitKeys() <= RATE_LIMIT_KEY_CEILING,
    `map must stay at or below the ceiling, tracked ${trackedRateLimitKeys()}`,
  );
  resetRateLimits();
});

test("eviction never turns a fresh caller away", () => {
  resetRateLimits();
  for (let i = 0; i < RATE_LIMIT_KEY_CEILING + 1_000; i++) {
    assert.equal(
      checkRateLimit(`flood-${i}`, 30, 60_000),
      true,
      "a first request from a new key must be admitted even under key pressure",
    );
  }
  resetRateLimits();
});

test("the limiter still throttles a single key within its window", () => {
  resetRateLimits();
  for (let i = 0; i < 5; i++) {
    assert.equal(checkRateLimit("device:abc", 5, 60_000), true, `request ${i + 1} of 5`);
  }
  assert.equal(checkRateLimit("device:abc", 5, 60_000), false, "the 6th is over budget");
  resetRateLimits();
});
