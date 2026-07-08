#!/usr/bin/env node
/**
 * SEAGUARD — Hardware Device Simulator
 *
 * Simulates an ESP32 SOS device by calling the real ingest API endpoints.
 * Use this to test the rescue dashboard without physical hardware.
 *
 * Usage:
 *   node simulate.mjs                        # interactive menu
 *   node simulate.mjs sos                    # fire LOW alert once
 *   node simulate.mjs sos high               # fire HIGH alert once
 *   node simulate.mjs location               # send one location ping
 *   node simulate.mjs cancel                 # cancel open alert
 *   node simulate.mjs loop [interval_s]      # loop location pings (default 15s)
 *   node simulate.mjs scenario               # full scenario: sos → loop → cancel
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

  if (res.ok) {
    return json;
  } else {
    log("✗", `HTTP ${res.status}: ${json.error ?? text}`, C.red);
    return null;
  }
}

// ─── GPS DRIFT ────────────────────────────────────────────────────
function drift() {
  lat += CONFIG.latDrift * (Math.random() * 2 - 1);
  lng += CONFIG.lngDrift * (Math.random() * 2 - 1);
  bat = Math.max(10, bat - 0.3); // slow drain
}

// ─── ACTIONS ─────────────────────────────────────────────────────
async function sendSOS(level = "LOW") {
  log("🆘", `Sending SOS (level=${level})  lat=${lat.toFixed(5)} lng=${lng.toFixed(5)}`, C.red);
  const res = await post("/api/public/ingest/sos", {
    device_id: CONFIG.deviceId,
    lat,
    lng,
    accuracy: CONFIG.accuracy,
    battery: Math.round(bat),
    level,
  });
  if (res) {
    log("✓", `Alert created — id: ${C.bold}${res.alert_id}${C.reset}`, C.green);
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
  });
  if (res) log("✓", "Alert cancelled", C.green);
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
