# SEAGUARD Hardware Integration Guide

This document describes how a physical SOS device (ESP32 + GPS module + SIM7600 cellular modem) communicates with the SEAGUARD platform.

---

## Prerequisites

1. The device must be **registered in the BMU console** (`/bmu` → Devices tab → Add)
2. After saving, reopen the device record to copy two values that must be flashed into the firmware:
   - `device_id` — the human-readable label printed on the hardware (e.g. `DEV-ABC123`)
   - `device_secret` — a 48-character hex string generated on registration

These two values are the only credentials the device ever needs.

---

## Authentication

Every HTTP request from the device must include:

```
Content-Type: application/json
x-device-secret: <48-char hex secret>
```

No JWT tokens, no cookies, no OAuth. The server does a **timing-safe comparison** of the secret against the stored value. If the device is disabled in the BMU console, all requests return `403`.

---

## Endpoints

Base URL: `https://your-domain.com`

All endpoints accept `POST` (and `OPTIONS` for CORS preflight). All responses are JSON.

---

### 1. `/api/public/ingest/sos` — SOS trigger

Send this **once when the SOS button is pressed**. Creates a new incident on the rescue dashboard and fires the alarm within ~1 second via Supabase Realtime.

**Request:**

```json
{
  "device_id": "DEV-ABC123",
  "lat": -4.0521,
  "lng": 39.7011,
  "accuracy": 12.5,
  "battery": 78,
  "level": "HIGH"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `device_id` | string | ✅ | Must match the registered device ID |
| `lat` | number | ✅ | Latitude in decimal degrees (−90 to 90) |
| `lng` | number | ✅ | Longitude in decimal degrees (−180 to 180) |
| `accuracy` | number | ❌ | GPS accuracy in metres |
| `battery` | number | ❌ | Battery percentage 0–100 |
| `level` | string | ❌ | `LOW` \| `MEDIUM` \| `HIGH` \| `CRITICAL` |

**Success response (200):**

```json
{
  "alert_id": "3f8a1b2c-...",
  "received_at": "2026-07-07T10:23:01.412Z"
}
```

**Server behaviour:**
- Looks up the device by `device_id`, validates the secret
- If no open alert exists → creates `sos_alerts` row with `status = "new"`, auto-populates `fisherman_id`, `boat_id`, `bmu_id` from the device's boat assignment
- If an open alert already exists → updates GPS position on existing row (idempotent)
- Inserts a `gps_logs` row
- Updates `devices.last_seen_at`

After sending `/sos`, switch immediately to `/location` for continuous position updates.

---

### 2. `/api/public/ingest/location` — Continuous GPS update

Send every **15 seconds** while the device is powered on (SOS active or not). Keeps the map marker moving in real time on the rescue dashboard.

**Request:**

```json
{
  "device_id": "DEV-ABC123",
  "lat": -4.0524,
  "lng": 39.7015,
  "accuracy": 10.0,
  "battery": 77
}
```

Same fields as `/sos`. `level` is optional and can be omitted on regular pings.

**Success response (200):**

```json
{
  "ok": true,
  "alert_id": "3f8a1b2c-... or null",
  "received_at": "2026-07-07T10:23:16.091Z"
}
```

`alert_id` is `null` when no open SOS exists — the GPS ping is still stored in `gps_logs` and updates `last_seen_at`.

**Server behaviour:**
- Inserts `gps_logs` row (linked to open alert if one exists)
- Updates `sos_alerts.last_lat/last_lng/last_ping_at` if open alert exists
- Updates `devices.last_seen_at`

---

### 3. `/api/public/ingest/cancel` — Cancel SOS (false alarm)

Send when the fisherman presses the cancel/safe button to cancel a false alarm.

**Request:**

```json
{
  "device_id": "DEV-ABC123"
}
```

Only `device_id` is required. No GPS needed.

**Success response (200):**

```json
{ "ok": true }
```

**Server behaviour:**
- Finds all open alerts for this device (`status` in `new`, `acknowledged`, `assigned`, `in_progress`)
- Sets `status = "closed"` and stamps `resolved_at`
- The rescue dashboard removes the alert from the active queue immediately

---

## Error Responses

| HTTP Status | Body | Meaning | Firmware action |
|-------------|------|---------|-----------------|
| `401` | `{"error": "Missing x-device-secret"}` | Header not sent | Check firmware — header missing |
| `401` | `{"error": "Invalid device credentials"}` | Wrong secret or device_id | Verify flashed values against BMU console |
| `403` | `{"error": "Device disabled"}` | Disabled in BMU console | Stop retrying — contact BMU officer |
| `400` | `{"error": "...zod message..."}` | Invalid payload | Fix field values (lat/lng range, etc.) |
| `5xx` | any | Server error | Retry with exponential backoff |

---

## Recommended Firmware Loop

```
BOOT
  └─ Load device_id and device_secret from flash

IDLE LOOP (no SOS active)
  └─ Every 15s: POST /location { device_id, lat, lng, battery }
  └─ On SOS button press → enter SOS LOOP

SOS LOOP
  ├─ Immediately: POST /sos { device_id, lat, lng, accuracy, battery, level }
  ├─ Every 15s:   POST /location { device_id, lat, lng, battery }
  └─ On cancel button press:
       POST /cancel { device_id }
       → return to IDLE LOOP
```

If cellular signal is lost, queue the packet and retry when signal resumes. The server deduplicates open alerts so sending `/sos` multiple times for the same incident is safe.

---

## ESP32 + SIM7600 Example (Arduino)

```cpp
#include <HTTPClient.h>
#include <ArduinoJson.h>

// Flash these two values per device — copy from BMU console
const char* DEVICE_ID     = "DEV-ABC123";
const char* DEVICE_SECRET = "a3f9c2...48hexchars...";
const char* BASE_URL      = "https://your-domain.com";

bool httpPost(const char* path, const char* body) {
  HTTPClient http;
  String url = String(BASE_URL) + path;
  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-device-secret", DEVICE_SECRET);

  int code = http.POST(body);
  http.end();

  if (code == 200) return true;
  if (code == 403) {
    // Device disabled — stop retrying
    Serial.println("Device disabled by BMU");
    return false;
  }
  // Retry on 4xx/5xx handled by caller
  return false;
}

void sendSOS(float lat, float lng, float accuracy, int battery) {
  StaticJsonDocument<256> doc;
  doc["device_id"] = DEVICE_ID;
  doc["lat"]       = lat;
  doc["lng"]       = lng;
  doc["accuracy"]  = accuracy;
  doc["battery"]   = battery;
  doc["level"]     = "HIGH";
  char body[256];
  serializeJson(doc, body);
  httpPost("/api/public/ingest/sos", body);
}

void sendLocation(float lat, float lng, int battery) {
  StaticJsonDocument<200> doc;
  doc["device_id"] = DEVICE_ID;
  doc["lat"]       = lat;
  doc["lng"]       = lng;
  doc["battery"]   = battery;
  char body[200];
  serializeJson(doc, body);
  httpPost("/api/public/ingest/location", body);
}

void cancelSOS() {
  StaticJsonDocument<64> doc;
  doc["device_id"] = DEVICE_ID;
  char body[64];
  serializeJson(doc, body);
  httpPost("/api/public/ingest/cancel", body);
}

bool sosActive = false;

void loop() {
  float lat = getGPSLat();   // your GPS read function
  float lng = getGPSLng();
  float acc = getGPSAccuracy();
  int   bat = getBatteryPct();

  if (sosButtonPressed() && !sosActive) {
    sosActive = true;
    sendSOS(lat, lng, acc, bat);
  }

  if (cancelButtonPressed() && sosActive) {
    sosActive = false;
    cancelSOS();
  }

  sendLocation(lat, lng, bat);  // always ping every 15s
  delay(15000);
}
```

---

## Provisioning a New Device

1. Open the BMU console → **Devices** tab → **Add**
2. Enter a `Device ID` (e.g. match the serial number on the PCB label)
3. Select the boat it belongs to and the hardware type
4. Click **Save**
5. Reopen the device record — the **Device credentials** panel appears
6. Copy the **Device secret** (click to copy to clipboard)
7. Flash `DEVICE_ID` and `DEVICE_SECRET` into the firmware
8. Power on the device — it will appear as "Active" in the BMU console after its first `/location` ping

---

## What Happens on the Dashboard When SOS Fires

```
Fisherman presses SOS button
        │
        ▼
POST /api/public/ingest/sos
        │
        ▼
Server inserts sos_alerts row (status = "new")
        │
        ▼
Supabase Realtime fires postgres_changes event
        │
        ▼
Rescue dashboard receives event (~1s latency)
        │
        ├─ Emergency banner flashes across top of screen
        ├─ Alarm audio plays (if enabled by officer)
        ├─ Alert appears at top of incident queue (red, flashing)
        └─ Map marker placed at fisherman's GPS coordinates
                │
                ▼ Every 15s (POST /location)
        Map marker moves in real time via Supabase Realtime
                │
                ▼ Officer assigns rescue team
        rescue_operations row created
        sos_alerts.status → "assigned"
                │
                ▼ Rescue completes
        rescue_operations.ended_at stamped
        sos_alerts.status → "resolved"
        Alert moves to resolved queue
```
