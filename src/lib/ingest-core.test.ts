/**
 * Failure matrix for the public hardware ingest endpoints.
 *
 * Every row of the device → API table in HARDWARE_INTEGRATION.md has a case
 * here: the system must fail predictably, and — critically — must never answer a
 * transient server fault with a permanent 4xx, because the firmware discards an
 * SOS on 4xx and retries on 5xx.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  handleCancel,
  handleLocation,
  handleSos,
  hasUsableFix,
  secretMatches,
  timestampIsFresh,
  type IngestDeps,
} from "./ingest-core";
import { createFakeStore, seedDevice, sha256Hex, type FakeStoreState } from "./ingest-test-store";

const NOW = new Date("2026-08-12T10:00:00.000Z");

function setup(seedFn?: (state: FakeStoreState) => void) {
  const { store, state } = createFakeStore();
  const { secretPlaintext } = seedDevice(state);
  seedFn?.(state);
  let traceCounter = 0;
  const deps: IngestDeps = {
    store,
    rateLimit: () => true,
    now: () => NOW,
    newTraceId: () => `trace-${++traceCounter}`,
  };
  return { deps, state, secret: secretPlaintext };
}

function request(body: unknown, secret?: string) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (secret !== undefined) headers["x-device-secret"] = secret;
  return new Request("https://seaguard.test/api/public/ingest/sos", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const sos = (deps: IngestDeps, body: unknown, secret?: string) =>
  handleSos(deps, request(body, secret), sha256Hex);
const location = (deps: IngestDeps, body: unknown, secret?: string) =>
  handleLocation(deps, request(body, secret), sha256Hex);
const cancel = (deps: IngestDeps, body: unknown, secret?: string) =>
  handleCancel(deps, request(body, secret), sha256Hex);

const VALID = { device_id: "DEV-TEST01", lat: -4.0521, lng: 39.7011, accuracy: 12.5, battery: 78 };

// ── Helpers ────────────────────────────────────────────────────────────────

test("secretMatches compares digests, not raw secrets", () => {
  const secret = "abc123";
  assert.equal(secretMatches(secret, sha256Hex(secret), sha256Hex), true);
  assert.equal(secretMatches("wrong", sha256Hex(secret), sha256Hex), false);
  // A shorter guess must not short-circuit to a match.
  assert.equal(secretMatches("", sha256Hex(secret), sha256Hex), false);
  assert.equal(secretMatches(secret, "", sha256Hex), false);
});

test("hasUsableFix rejects the TinyGPS++ no-fix sentinel", () => {
  assert.equal(hasUsableFix(-4.05, 39.7), true);
  assert.equal(hasUsableFix(0, 0), false, "0,0 is 'no fix', not Null Island");
  assert.equal(hasUsableFix(undefined, undefined), false);
  assert.equal(hasUsableFix(-4.05, 39.7, false), false, "explicit gps_fix=false wins");
  assert.equal(hasUsableFix(0, 39.7), true, "a genuine zero latitude is still a fix");
});

test("timestampIsFresh bounds the replay window but stays optional", () => {
  assert.equal(timestampIsFresh(undefined, NOW), true);
  assert.equal(timestampIsFresh(NOW.toISOString(), NOW), true);
  assert.equal(timestampIsFresh("2026-08-12T09:55:00.000Z", NOW), true);
  assert.equal(timestampIsFresh("2026-08-12T09:30:00.000Z", NOW), false);
  assert.equal(timestampIsFresh("2026-08-12T10:30:00.000Z", NOW), false);
  assert.equal(timestampIsFresh("not-a-date", NOW), false);
});

// ── SOS: happy path ────────────────────────────────────────────────────────

test("valid SOS creates an alert, a GPS log and touches the device", async () => {
  const { deps, state, secret } = setup((s) =>
    s.owners.set("fisherman-1", { bmuId: "bmu-1", boatId: "boat-1" }),
  );
  const res = await sos(deps, { ...VALID, level: "HIGH" }, secret);
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.ok(body.alert_id);
  assert.equal(body.gps_fix, true);
  assert.equal(body.duplicate, false);
  assert.equal(res.headers.get("x-seaguard-trace"), body.trace_id);
  assert.equal(state.alerts.length, 1);
  assert.equal(state.alerts[0].status, "new");
  assert.equal(state.alerts[0].level, "HIGH");
  assert.equal(state.gpsLogs.length, 1);
  assert.equal(state.lastSeen.get("device-uuid-1"), NOW.toISOString());
  assert.equal(state.logs.at(-1)?.statusCode, 200);
});

test("SOS is accepted without a GPS fix and records why", async () => {
  const { deps, state, secret } = setup();
  const res = await sos(deps, { device_id: "DEV-TEST01", battery: 60 }, secret);
  const body = await res.json();

  assert.equal(res.status, 200, "a distress call must not be dropped for want of a fix");
  assert.equal(body.gps_fix, false);
  assert.equal(state.alerts.length, 1);
  assert.equal(state.alerts[0].lat, null);
  assert.match(state.alerts[0].notes ?? "", /without a GPS fix/i);
  assert.equal(state.gpsLogs.length, 0, "no fix means no GPS log row");
});

test("SOS sent with 0,0 coordinates is stored as no-fix", async () => {
  const { deps, state, secret } = setup();
  const res = await sos(deps, { device_id: "DEV-TEST01", lat: 0, lng: 0 }, secret);

  assert.equal(res.status, 200);
  assert.equal((await res.json()).gps_fix, false);
  assert.equal(state.alerts[0].lat, null);
});

// ── SOS: deduplication and idempotency ─────────────────────────────────────

test("duplicate SOS updates the open alert instead of creating a second", async () => {
  const { deps, state, secret } = setup();
  const first = await (await sos(deps, VALID, secret)).json();
  const second = await (
    await sos(deps, { ...VALID, lat: -4.06, lng: 39.71, level: "HIGH" }, secret)
  ).json();

  assert.equal(second.alert_id, first.alert_id);
  assert.equal(second.duplicate, true);
  assert.equal(state.alerts.length, 1);
  assert.equal(state.alerts[0].lat, -4.06, "position advances on the existing incident");
  assert.equal(state.alerts[0].level, "HIGH", "a second press escalates the level");
});

test("replayed event_id returns the original alert after it was closed", async () => {
  const { deps, state, secret } = setup();
  const first = await (await sos(deps, { ...VALID, event_id: "evt-1" }, secret)).json();

  // The incident is resolved, then the device retries a response it never saw.
  state.alerts[0].status = "closed";
  const retry = await (await sos(deps, { ...VALID, event_id: "evt-1" }, secret)).json();

  assert.equal(retry.alert_id, first.alert_id);
  assert.equal(retry.duplicate, true);
  assert.equal(state.alerts.length, 1, "a lost response must not reopen a closed incident");
});

test("escalation needs a fresh event_id — a reused one is a no-op", async () => {
  const { deps, state, secret } = setup();
  await sos(deps, { ...VALID, level: "LOW", event_id: "press-1" }, secret);

  // Contract the firmware relies on: each button press mints its own event_id.
  // Reusing the first press's id short-circuits on idempotency and changes
  // nothing, so queueSos() must not reuse it when escalating.
  await sos(deps, { ...VALID, level: "HIGH", event_id: "press-1" }, secret);
  assert.equal(state.alerts[0].level, "LOW", "a replayed event_id must not mutate the alert");

  await sos(deps, { ...VALID, level: "HIGH", event_id: "press-2" }, secret);
  assert.equal(state.alerts[0].level, "HIGH", "a new press escalates the open incident");
  assert.equal(state.alerts.length, 1, "escalation must not open a second incident");
});

test("multiple open alerts on one device do not create yet another", async () => {
  const { deps, state, secret } = setup();
  // The software SOS path can leave two open alerts; the old `.maybeSingle()`
  // query errored on this and silently inserted a third.
  await sos(deps, VALID, secret);
  state.alerts.push({
    ...state.alerts[0],
    id: "alert-legacy",
    startedAt: "2026-08-12T09:00:00.000Z",
  });

  const res = await sos(deps, VALID, secret);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).alert_id, "alert-1", "newest open alert wins");
  assert.equal(state.alerts.length, 2);
});

// ── Authentication and authorisation ───────────────────────────────────────

test("missing secret is rejected as 401 without touching storage", async () => {
  const { deps, state, secret: _ } = setup();
  const res = await sos(deps, VALID);
  assert.equal(res.status, 401);
  assert.equal((await res.json()).error, "Invalid device credentials");
  assert.equal(state.alerts.length, 0);
});

test("invalid secret and unknown device return an identical 401", async () => {
  const { deps } = setup();
  const badSecret = await sos(deps, VALID, "wrong-secret");
  const unknownDevice = await sos(deps, { ...VALID, device_id: "DEV-NOPE" }, "wrong-secret");

  assert.equal(badSecret.status, 401);
  assert.equal(unknownDevice.status, 401);
  assert.deepEqual(
    await badSecret.json(),
    await unknownDevice.json(),
    "responses must not let an attacker enumerate device IDs",
  );
});

test("disabled device is rejected as 403 so firmware stops retrying", async () => {
  const { deps, state, secret } = setup((s) => {
    const device = s.devices.get("DEV-TEST01")!;
    s.devices.set("DEV-TEST01", { ...device, active: false });
  });
  const res = await sos(deps, VALID, secret);
  assert.equal(res.status, 403);
  assert.equal((await res.json()).error, "Device disabled");
  assert.equal(state.alerts.length, 0);
});

test("disabled device is also blocked on location and cancel", async () => {
  const { deps, secret } = setup((s) => {
    const device = s.devices.get("DEV-TEST01")!;
    s.devices.set("DEV-TEST01", { ...device, active: false });
  });
  assert.equal((await location(deps, VALID, secret)).status, 403);
  assert.equal((await cancel(deps, { device_id: "DEV-TEST01" }, secret)).status, 403);
});

// ── Payload validation ─────────────────────────────────────────────────────

test("malformed JSON is a 400", async () => {
  const { deps, secret } = setup();
  const res = await sos(deps, "{not json", secret);
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /Malformed JSON/);
});

test("out-of-range values are rejected with field names only", async () => {
  const { deps, secret } = setup();
  const cases: [string, unknown][] = [
    ["lat", { ...VALID, lat: 91 }],
    ["lng", { ...VALID, lng: -181 }],
    ["battery", { ...VALID, battery: 140 }],
    ["level", { ...VALID, level: "CRITICAL" }],
    ["accuracy", { ...VALID, accuracy: -1 }],
    ["device_id", { ...VALID, device_id: "" }],
  ];
  for (const [field, body] of cases) {
    const res = await sos(deps, body, secret);
    assert.equal(res.status, 400, `${field} should be rejected`);
    assert.match((await res.json()).error, new RegExp(field), `error should name ${field}`);
  }
});

test("stale device timestamp is rejected", async () => {
  const { deps, secret } = setup();
  const res = await sos(deps, { ...VALID, timestamp: "2026-08-12T08:00:00.000Z" }, secret);
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /timestamp/i);
});

// ── Storage failures must be retryable ─────────────────────────────────────

test("alert insert failure returns a retryable 503, not a permanent 400", async () => {
  const { deps, state, secret } = setup((s) => s.failOn.add("createAlert"));
  const res = await sos(deps, VALID, secret);

  assert.equal(res.status, 503, "a database outage must not tell the device to give up");
  assert.equal((await res.json()).error, "Service temporarily unavailable");
  assert.equal(state.logs.at(-1)?.statusCode, 503);
});

test("device lookup failure returns 503", async () => {
  const { deps, secret } = setup((s) => s.failOn.add("findDevice"));
  assert.equal((await sos(deps, VALID, secret)).status, 503);
});

test("server errors never leak internal detail to the caller", async () => {
  const { deps, state, secret } = setup((s) => s.failOn.add("createAlert"));
  const body = await (await sos(deps, VALID, secret)).json();

  assert.equal(body.error, "Service temporarily unavailable");
  assert.doesNotMatch(JSON.stringify(body), /simulated storage failure/);
  assert.match(
    state.logs.at(-1)?.errorMessage ?? "",
    /simulated storage failure/,
    "the detail belongs in the server-side audit log",
  );
});

test("rate limited requests return 429", async () => {
  const { deps, secret } = setup();
  const res = await sos({ ...deps, rateLimit: () => false }, VALID, secret);
  assert.equal(res.status, 429);
});

// ── Location ───────────────────────────────────────────────────────────────

test("location ping links to an open alert and advances its position", async () => {
  const { deps, state, secret } = setup();
  await sos(deps, VALID, secret);

  const res = await location(deps, { ...VALID, lat: -4.07, lng: 39.72, battery: 71 }, secret);
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.alert_id, "alert-1");
  assert.equal(state.alerts[0].lat, -4.07);
  assert.equal(state.alerts[0].battery, 71);
  assert.equal(state.gpsLogs.at(-1)?.alertId, "alert-1");
});

test("location ping with no open alert is stored unlinked", async () => {
  const { deps, state, secret } = setup();
  const body = await (await location(deps, VALID, secret)).json();

  assert.equal(body.alert_id, null);
  assert.equal(state.gpsLogs.length, 1);
  assert.equal(state.gpsLogs[0].alertId, null);
  assert.equal(state.lastSeen.get("device-uuid-1"), NOW.toISOString());
});

test("location requires real coordinates", async () => {
  const { deps, secret } = setup();
  assert.equal((await location(deps, { device_id: "DEV-TEST01" }, secret)).status, 400);
  assert.equal(
    (await location(deps, { device_id: "DEV-TEST01", lat: 0, lng: 0 }, secret)).status,
    400,
  );
});

// ── Cancel ─────────────────────────────────────────────────────────────────

test("cancel closes every open alert for the device", async () => {
  const { deps, state, secret } = setup();
  await sos(deps, VALID, secret);

  const body = await (await cancel(deps, { device_id: "DEV-TEST01" }, secret)).json();
  assert.equal(body.ok, true);
  assert.equal(body.cancelled, 1);
  assert.equal(state.alerts[0].status, "closed");
});

test("cancel with no open alert succeeds and is a no-op", async () => {
  const { deps, state, secret } = setup();
  const body = await (await cancel(deps, { device_id: "DEV-TEST01" }, secret)).json();

  assert.equal(body.ok, true);
  assert.equal(body.cancelled, 0);
  assert.equal(state.notifications.length, 0);
});

test("cancel after rescue engagement notifies the rescue dashboard", async () => {
  const { deps, state, secret } = setup();
  await sos(deps, VALID, secret);
  state.alerts[0].status = "assigned"; // rescue officer already dispatched

  const body = await (
    await cancel(deps, { device_id: "DEV-TEST01", reason: "False alarm" }, secret)
  ).json();

  assert.equal(body.cancelled, 1);
  assert.equal(body.notified_rescue, 1, "an in-progress response must not be erased silently");
  assert.deepEqual(state.notifications, [
    { alertId: "alert-1", previousStatus: "assigned", reason: "False alarm" },
  ]);
});

test("cancel of an unacknowledged alert sends no rescue notification", async () => {
  const { deps, state, secret } = setup();
  await sos(deps, VALID, secret);

  const body = await (await cancel(deps, { device_id: "DEV-TEST01" }, secret)).json();
  assert.equal(body.notified_rescue, 0);
  assert.equal(state.notifications.length, 0);
});

test("cancel storage failure is retryable and leaves alerts open", async () => {
  const { deps, state, secret } = setup((s) => s.failOn.add("cancelAlerts"));
  await sos(deps, VALID, secret);

  const res = await cancel(deps, { device_id: "DEV-TEST01" }, secret);
  assert.equal(res.status, 503);
  assert.equal(state.alerts[0].status, "new", "a failed cancel must not half-close the incident");
});
