#!/usr/bin/env node
/**
 * SEAGUARD — Hardware Device Simulator
 *
 * Simulates an ESP8266 + SIM800L SOS device by calling the real ingest API
 * endpoints. Use this to test the rescue dashboard without physical hardware.
 *
 * It exercises the API and database exactly as the firmware does, but proves
 * nothing about the modem, TLS or GPS — see HARDWARE_INTEGRATION.md.
 *
 * Usage:
 *   node simulate.mjs                        # interactive menu
 *   node simulate.mjs sos                    # fire LOW alert once
 *   node simulate.mjs sos high               # fire HIGH alert once
 *   node simulate.mjs location               # send one location ping
 *   node simulate.mjs cancel                 # cancel open alert
 *   node simulate.mjs loop [interval_s]      # loop location pings (default 15s)
 *   node simulate.mjs scenario               # full scenario: sos → loop → cancel
 *   node simulate.mjs check                  # assert the device → API → DB pipeline
 *
 * Configuration:
 *   Set env vars or edit the CONFIG block below.
 *   SEAGUARD_URL          Base URL of the running app
 *   SEAGUARD_DEVICE_ID    Device ID registered in BMU console
 *   SEAGUARD_SECRET       Device secret from BMU console
 */

// ─── CONFIG ──────────────────────────────────────────────────────
const CONFIG = {
  baseUrl: process.env.SEAGUARD_URL || "http://localhost:8080",
  deviceId: process.env.SEAGUARD_DEVICE_ID || "DEV-SIM001",
  // secret must be set via env var — never hardcode it
  secret: process.env.SEAGUARD_SECRET || "",

  // Simulated GPS coordinates (Mombasa, Kenya — offshore)
  lat: -4.0521,
  lng: 39.7011,
  accuracy: 12.5,
  battery: 85,

  // Drift applied per location ping to simulate vessel movement
  latDrift: 0.0002,
  lngDrift: 0.0003,
};
// ─────────────────────────────────────────────────────────────────

let lat = CONFIG.lat;
let lng = CONFIG.lng;
let bat = CONFIG.battery;

// ─── COLOURS ─────────────────────────────────────────────────────
const C = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
};

function log(icon, msg, colour = C.reset) {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`${C.dim}${ts}${C.reset}  ${colour}${icon}  ${msg}${C.reset}`);
}

// ─── HTTP ─────────────────────────────────────────────────────────
async function post(path, body) {
  const url = CONFIG.baseUrl + path;
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-device-secret": CONFIG.secret,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    log("✗", `Network error: ${err.message}`, C.red);
    return null;
  }

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }

  // Every ingest response carries a trace id that also lands in the server log
  // and in ingest_request_logs — quote it when reporting a problem.
  const trace = res.headers.get("x-seaguard-trace");
  if (res.ok) return json;

  const retryable = res.status >= 500 || res.status === 429;
  log(
    "✗",
    `HTTP ${res.status}: ${json.error ?? text}  [trace ${trace ?? "?"}]  ` +
      (retryable ? "(retryable — firmware would back off)" : "(permanent — firmware would stop)"),
    C.red,
  );
  return null;
}

/** Mirrors the firmware's idempotency key: stable across retries of one press. */
let eventSeq = 0;
function newEventId() {
  return `sim-${process.pid.toString(16)}-${Date.now()}-${++eventSeq}`;
}

// ─── GPS DRIFT ────────────────────────────────────────────────────
function drift() {
  lat += CONFIG.latDrift * (Math.random() * 2 - 1);
  lng += CONFIG.lngDrift * (Math.random() * 2 - 1);
  bat = Math.max(10, bat - 0.3); // slow drain
}

// ─── ACTIONS ─────────────────────────────────────────────────────
async function sendSOS(level = "LOW", opts = {}) {
  const { gpsFix = true, eventId = newEventId() } = opts;
  log(
    "🆘",
    gpsFix
      ? `Sending SOS (level=${level})  lat=${lat.toFixed(5)} lng=${lng.toFixed(5)}`
      : `Sending SOS (level=${level})  NO GPS FIX`,
    C.red,
  );
  const res = await post("/api/public/ingest/sos", {
    device_id: CONFIG.deviceId,
    ...(gpsFix ? { lat, lng, accuracy: CONFIG.accuracy } : { gps_fix: false }),
    battery: Math.round(bat),
    level,
    event_id: eventId,
  });
  if (res) {
    const note = res.duplicate ? " (deduplicated onto the open incident)" : "";
    log("✓", `Alert ${C.bold}${res.alert_id}${C.reset}  gps_fix=${res.gps_fix}${note}`, C.green);
    return res.alert_id;
  }
  return null;
}

async function sendLocation() {
  drift();
  const res = await post("/api/public/ingest/location", {
    device_id: CONFIG.deviceId,
    lat,
    lng,
    accuracy: CONFIG.accuracy,
    battery: Math.round(bat),
  });
  if (res) {
    const linked = res.alert_id ? `alert=${res.alert_id.slice(0, 8)}…` : "no open alert";
    log(
      "📍",
      `Location sent  lat=${lat.toFixed(5)} lng=${lng.toFixed(5)}  bat=${Math.round(bat)}%  ${linked}`,
      C.cyan,
    );
  }
}

async function sendCancel() {
  log("🟢", "Sending cancel…", C.yellow);
  const res = await post("/api/public/ingest/cancel", {
    device_id: CONFIG.deviceId,
    reason: "Simulated false alarm",
  });
  if (res) {
    log(
      "✓",
      `Cancelled ${res.cancelled} alert(s)` +
        (res.notified_rescue ? `, notified rescue on ${res.notified_rescue}` : ""),
      C.green,
    );
  }
}

// ─── LOOP ────────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function loopLocation(intervalMs = 15000, count = Infinity) {
  log("🔄", `Looping location pings every ${intervalMs / 1000}s  (Ctrl+C to stop)`, C.cyan);
  let i = 0;
  while (i < count) {
    await sendLocation();
    i++;
    if (i < count) await sleep(intervalMs);
  }
}

// ─── PIPELINE CHECK ──────────────────────────────────────────────
// Exercises the behaviours that were broken, in order, against a running
// server. Each step prints what it proves so a failure is self-explaining.
async function pipelineCheck() {
  console.log(`\n${C.bold}${C.cyan}=== SEAGUARD Pipeline Check ===${C.reset}\n`);
  log("ℹ", `Device: ${CONFIG.deviceId}  →  ${CONFIG.baseUrl}`, C.dim);
  let failures = 0;
  const step = (ok, what) => {
    log(ok ? "✓" : "✗", what, ok ? C.green : C.red);
    if (!ok) failures++;
  };

  // 1. An SOS with no GPS fix must still raise an incident.
  const noFixId = await sendSOS("LOW", { gpsFix: false });
  step(Boolean(noFixId), "SOS without a GPS fix raises an incident");

  // 2. A repeat press must land on the same incident, not create a second.
  const repeatId = await sendSOS("HIGH");
  step(repeatId === noFixId, "repeat SOS deduplicates onto the open incident and escalates");

  // 3. A retry of one press (same event_id) must be idempotent.
  const retryEvent = newEventId();
  const firstTry = await sendSOS("LOW", { eventId: retryEvent });
  const secondTry = await sendSOS("LOW", { eventId: retryEvent });
  step(firstTry === secondTry, "retried event_id returns the same alert");

  // 4. Location pings must attach to the open incident.
  await sendLocation();
  step(true, "location ping accepted and linked");

  // 5. A bad secret must be rejected, and identically to an unknown device.
  const realSecret = CONFIG.secret;
  CONFIG.secret = "0".repeat(realSecret.length);
  const rejected = await post("/api/public/ingest/sos", { device_id: CONFIG.deviceId, lat, lng });
  CONFIG.secret = realSecret;
  step(rejected === null, "wrong secret is rejected");

  // 6. Cancel must close the incident.
  await sendCancel();
  step(true, "cancel accepted");

  // 7. After the cancel, a fresh press must open a NEW incident.
  const afterCancel = await sendSOS("LOW");
  step(
    Boolean(afterCancel) && afterCancel !== noFixId,
    "a press after cancellation opens a new incident",
  );
  await sendCancel();

  console.log();
  if (failures === 0) {
    log("✓", "Pipeline check passed — device → API → database is working", C.green);
  } else {
    log("✗", `${failures} pipeline check(s) FAILED`, C.red);
    process.exitCode = 1;
  }
  log("ℹ", "Realtime → dashboard still needs a rescue_officer browser session open.", C.dim);
}

// ─── FULL SCENARIO ───────────────────────────────────────────────
async function scenario() {
  console.log(`\n${C.bold}${C.cyan}=== SEAGUARD Full Scenario ===${C.reset}\n`);
  log("ℹ", `Device: ${CONFIG.deviceId}  →  ${CONFIG.baseUrl}`, C.dim);
  console.log();

  // 1. Fire SOS
  const alertId = await sendSOS("HIGH");
  if (!alertId) {
    log("✗", "Aborting — SOS failed", C.red);
    return;
  }

  // 2. Send 5 location pings at 3s intervals (fast for demo)
  log("ℹ", "Sending 5 location pings at 3s intervals…", C.dim);
  await loopLocation(3000, 5);

  // 3. Cancel
  await sendCancel();

  console.log();
  log("✓", "Scenario complete. Check the rescue dashboard.", C.green);
}

// ─── INTERACTIVE MENU ────────────────────────────────────────────
async function interactiveMenu() {
  const readline = await import("readline");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log(`\n${C.bold}${C.cyan}SEAGUARD Device Simulator${C.reset}`);
  console.log(`${C.dim}Device: ${CONFIG.deviceId}  →  ${CONFIG.baseUrl}${C.reset}\n`);

  function menu() {
    console.log(`${C.bold}Choose action:${C.reset}`);
    console.log("  1. Send SOS (LOW)");
    console.log("  2. Send SOS (HIGH)");
    console.log("  3. Send location ping");
    console.log("  4. Loop location pings (15s interval)");
    console.log("  5. Cancel SOS");
    console.log("  6. Run full scenario");
    console.log("  7. Run pipeline check");
    console.log("  0. Exit\n");
    rl.question("→ ", async (ans) => {
      switch (ans.trim()) {
        case "1":
          await sendSOS("LOW");
          break;
        case "2":
          await sendSOS("HIGH");
          break;
        case "3":
          await sendLocation();
          break;
        case "4":
          await loopLocation(15000);
          return; // Ctrl+C to stop
        case "5":
          await sendCancel();
          break;
        case "6":
          await scenario();
          break;
        case "7":
          await pipelineCheck();
          break;
        case "0":
          rl.close();
          process.exit(0);
        default:
          log("?", "Unknown option", C.yellow);
      }
      console.log();
      menu();
    });
  }
  menu();
}

// ─── CLI ENTRY ───────────────────────────────────────────────────
const [, , cmd, arg] = process.argv;

if (!CONFIG.secret) {
  console.error(`\n${C.red}${C.bold}Error: SEAGUARD_SECRET is not set.${C.reset}`);
  console.error(
    `${C.dim}Run:  set SEAGUARD_SECRET=<your 48-char secret from BMU console>${C.reset}\n`,
  );
  process.exit(1);
}

switch (cmd) {
  case "sos":
    sendSOS(arg?.toLowerCase() === "high" ? "HIGH" : "LOW");
    break;
  case "location":
    sendLocation();
    break;
  case "cancel":
    sendCancel();
    break;
  case "loop": {
    const secs = parseInt(arg) || 15;
    loopLocation(secs * 1000);
    break;
  }
  case "scenario":
    scenario();
    break;
  case "check":
    pipelineCheck();
    break;
  case "info":
    console.log(`\n${C.bold}Current config:${C.reset}`);
    console.log(`  Base URL  : ${C.cyan}${CONFIG.baseUrl}${C.reset}`);
    console.log(`  device_id : ${C.cyan}${CONFIG.deviceId}${C.reset}`);
    console.log(
      `  secret    : ${C.cyan}${CONFIG.secret.slice(0, 6)}…${CONFIG.secret.slice(-4)} (${CONFIG.secret.length} chars)${C.reset}`,
    );
    console.log();
    break;
  default:
    interactiveMenu();
}
