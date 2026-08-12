# SEAGUARD Hardware Integration Guide

How a physical SOS device (ESP8266 + NEO-6M GPS + SIM800L cellular modem) talks to
the SEAGUARD platform.

This document describes the behaviour that is actually implemented in
[`firmware/rescue_watch/`](./firmware/rescue_watch/) and
[`src/lib/ingest-core.ts`](./src/lib/ingest-core.ts). Where an earlier revision of this
guide described features that did not exist (OLED display, battery ADC, exponential
backoff), the guide has been corrected rather than the code — except where the feature
was genuinely worth having, in which case it was implemented. See
[Changes from the previous revision](#changes-from-the-previous-revision).

---

## Hardware

| Part      | Model                    | Notes                                                       |
| --------- | ------------------------ | ----------------------------------------------------------- |
| MCU       | ESP8266 (NodeMCU 1.0)    | Not ESP32 — see [Porting to ESP32](#porting-to-esp32)       |
| GPS       | NEO-6M or similar NMEA   | SoftwareSerial @ 9600 baud                                   |
| Modem     | SIM800L                  | SoftwareSerial @ 9600 baud, HTTP(S) via AT commands          |
| Button    | Momentary, to GND        | `INPUT_PULLUP`, no external resistor                         |
| LED       | Status indicator         | Idle off / fast blink sending / solid when SOS is confirmed  |

There is **no OLED display** and **no buzzer**. Feedback is the LED and the serial console.

### Pin map

| Signal          | NodeMCU pin | GPIO   |
| --------------- | ----------- | ------ |
| Button          | `D5`        | GPIO14 |
| Status LED      | `D0`        | GPIO16 |
| SIM800L TX → ESP| `D2`        | GPIO4  |
| ESP → SIM800L RX| `D1`        | GPIO5  |
| GPS TX → ESP    | `D6`        | GPIO12 |
| ESP → GPS TX    | `D7`        | GPIO13 |

Both peripherals sit on `SoftwareSerial` because UART0 is the USB console and UART1 is
transmit-only on the ESP8266. Only one `SoftwareSerial` instance can receive at a time,
so the GPS parser is fed whenever the modem is idle and the position is sampled
immediately before each transmission.

---

## Prerequisites

1. Register the device in the BMU console (`/bmu` → Devices → Add), assigning it to a fisherman.
2. On save, the **device secret is displayed once**. Copy it then — it cannot be read back.
3. Copy `firmware/rescue_watch/secrets.example.h` to `secrets.h` and fill in the values.

```bash
cd firmware/rescue_watch
cp secrets.example.h secrets.h
# edit secrets.h
```

`secrets.h` is git-ignored. **Never commit device credentials.** A secret that reaches
version control is compromised — rotate it (below) before deploying the device.

### Rotating a device secret

Use this when a secret is lost, leaked, or committed by mistake.

1. `/bmu` → Devices → open the device → **Rotate device secret**
2. Enter a reason (recorded in the audit log)
3. Copy the new secret — again shown only once
4. Update `secrets.h` and re-flash

The old secret stops working immediately, so the device is offline until it is
re-flashed. Rotation is the only remediation for a leaked secret; there is no way to
read an existing one back out of the system.

---

## Authentication

Every request carries:

```
Content-Type: application/json
x-device-secret: <64-char hex secret>
```

No JWT, no cookies, no OAuth. Secrets are stored as SHA-256 digests, and the server
compares digests in constant time. Unknown device IDs and wrong secrets produce an
identical `401`, so the endpoint cannot be used to enumerate valid device IDs.

---

## Endpoints

Base URL: `https://your-domain.com`. All accept `POST` (and `OPTIONS` for CORS).
All responses are JSON and carry an `x-seaguard-trace` header — quote that trace id in
bug reports; it appears in the server logs and in `ingest_request_logs`.

### 1. `POST /api/public/ingest/sos`

Raises or updates a distress incident.

```json
{
  "device_id": "DEV-ABC123",
  "lat": -4.0521,
  "lng": 39.7011,
  "accuracy": 12.5,
  "battery": 78,
  "level": "HIGH",
  "gps_fix": true,
  "event_id": "a1b2c3d4-104729-7"
}
```

| Field       | Type    | Required | Description                                                        |
| ----------- | ------- | -------- | ------------------------------------------------------------------ |
| `device_id` | string  | ✅       | Must match the registered device ID                                |
| `lat`       | number  | ❌       | −90 to 90. **Optional** — see below                                |
| `lng`       | number  | ❌       | −180 to 180                                                         |
| `accuracy`  | number  | ❌       | Metres (the firmware sends HDOP)                                    |
| `battery`   | number  | ❌       | 0–100. Omitted when the device cannot measure it                    |
| `level`     | string  | ❌       | `LOW` \| `HIGH`                                                     |
| `gps_fix`   | boolean | ❌       | Explicitly `false` when the device has no fix                       |
| `event_id`  | string  | ❌       | Idempotency key, stable across retries of the same press            |
| `timestamp` | string  | ❌       | ISO-8601. Rejected if more than 10 minutes from server time         |

**An SOS is accepted without coordinates.** A distress call must never be dropped
because the GPS module has no fix; the incident is what matters and the position
follows on the next `/location` ping. `0,0` is treated as "no fix", not as a position
in the Gulf of Guinea.

**Response (200):**

```json
{
  "alert_id": "3f8a1b2c-...",
  "received_at": "2026-08-12T10:23:01.412Z",
  "gps_fix": true,
  "duplicate": false,
  "trace_id": "..."
}
```

**Server behaviour**

- Looks up the device, compares the secret digest, rejects disabled devices
- If `event_id` matches an alert already created for this device → returns that alert, changes nothing
- Else if an open alert exists (`new`/`acknowledged`/`assigned`/`in_progress`) → updates its position, battery and level
- Else → inserts a `sos_alerts` row with `status = "new"`, resolving `fisherman_id` from the device and `bmu_id`/`boat_id` from the fisherman and their active trip
- Inserts a `gps_logs` row when there is a fix
- Updates `devices.last_seen_at`

### 2. `POST /api/public/ingest/location`

Continuous position, every 15 s, whether or not an SOS is active.

```json
{ "device_id": "DEV-ABC123", "lat": -4.0524, "lng": 39.7015, "accuracy": 10.0, "battery": 77 }
```

`lat` and `lng` are **required** here — a ping without a position carries no
information. The firmware skips the ping entirely when it has no fresh fix.

**Response (200):** `{ "ok": true, "alert_id": "... or null", "received_at": "...", "trace_id": "..." }`

`alert_id` is `null` when no SOS is open; the fix is still stored in `gps_logs` and
still refreshes `last_seen_at`.

### 3. `POST /api/public/ingest/cancel`

```json
{ "device_id": "DEV-ABC123", "reason": "Cancelled from device" }
```

**Response (200):** `{ "ok": true, "cancelled": 1, "notified_rescue": 0, "received_at": "...", "trace_id": "..." }`

**Server behaviour** — one atomic transaction (`hardware_cancel_sos`):

- Closes every open alert for the device (`status = "closed"`, `resolved_at` stamped, reason appended to notes)
- Closes any linked `rescue_operations`
- Restores the fisherman's trip from `sos`/`rescue_in_progress` back to `at_sea`
- If any cancelled alert had already been **acknowledged, assigned or in progress**, a
  dashboard notification is raised for the rescue officers — an in-progress response is
  never erased silently

GPS logs, trip history and closed alert rows are never deleted.

---

## Status codes

The firmware's retry policy depends on this table, so it is a contract, not a suggestion.

| Status | Body                                       | Meaning                    | Firmware action                        |
| ------ | ------------------------------------------ | -------------------------- | -------------------------------------- |
| `200`  | endpoint payload                           | Accepted                   | Done                                   |
| `400`  | `{"error": "Invalid payload fields: ..."}` | Malformed request          | **Stop.** Fix the payload              |
| `401`  | `{"error": "Invalid device credentials"}`  | Unknown device or bad secret | **Stop.** Check `secrets.h`          |
| `403`  | `{"error": "Device disabled"}`             | Disabled in the BMU console | **Stop.** Contact the BMU officer     |
| `429`  | `{"error": "Too many requests"}`           | Rate limited               | Retry with backoff                     |
| `503`  | `{"error": "Service temporarily unavailable"}` | Database unavailable   | Retry with backoff                     |
| `500`  | `{"error": "Internal server error"}`       | Unexpected fault           | Retry with backoff                     |

A server-side failure is **always** a 5xx. An earlier revision returned `400` for
database errors, which told the firmware an emergency was permanently invalid.

Error bodies never contain internal detail; the underlying message goes to the server
log and `ingest_request_logs`, keyed by the trace id.

---

## Firmware behaviour

### Button

| Gesture                                     | Effect                                             |
| ------------------------------------------- | -------------------------------------------------- |
| Short press, no SOS open                    | Raise SOS at level `LOW`                            |
| Short press while an SOS is open or pending | Escalate that SOS to level `HIGH`                   |
| Hold ≥ 3 s while an SOS is open or pending  | Cancel (false alarm)                                |
| Hold ≥ 3 s with no SOS open                 | **Ignored**                                         |

Debounced with a 50 ms settle on `millis()`; no `delay()` in the button path.

Two deliberate design points:

- **Holding the button never sends a cancel unless there is something to cancel.**
  The previous firmware cancelled after a 1.5 s hold regardless of state, so gripping
  the button during an emergency — the natural reaction — sent a cancel instead of an SOS.
- **Escalation is a second press, not a double-click within a window.** The documented
  "double press = HIGH" is preserved in effect, but the first press transmits
  immediately at `LOW` rather than waiting to see whether a second one arrives. An
  emergency signal is never delayed to disambiguate a gesture; the server treats the
  repeat `/sos` as an update to the open incident and raises its level in place.

### GPS

- `feedGps()` runs every loop iteration whenever the modem is idle
- A fix counts only if `location.isValid()`, `location.age() < 60 s`, and it is not `0,0`
- No fix never blocks transmission: `/sos` goes out with `gps_fix: false`, `/location` is skipped
- `accuracy` carries HDOP, or `99.0` when HDOP is unavailable

### Retry

- **SOS**: retries indefinitely with exponential backoff (2 s → 4 s → 8 s → 16 s → 32 s, capped at 60 s) until the server confirms it. Stops only on a permanent 4xx, which is reported on the serial console. An SOS is never silently discarded.
- **Cancel**: retried every loop pass until accepted or permanently rejected.
- **Location**: not retried. The next ping is 15 s away and carries a newer position.

Each SOS carries an `event_id` that is stable across retries, so a retry whose response
was lost cannot open a second incident.

### Battery

Battery reporting is **disabled by default** (`BATTERY_SENSE_ENABLED 0` in
`rescue_watch.ino`) and the `battery` field is then omitted from every payload.

Reporting a fabricated percentage is worse than reporting none: the BMU console would
show a healthy battery for a device that is about to die. The previous firmware sent a
hardcoded `80`.

To enable it, fit a divider, measure it, set `BATTERY_DIVIDER_FULL_SCALE_V` and
`BATTERY_EMPTY_V` from that measurement, and set `BATTERY_SENSE_ENABLED` to `1`. The
values in the sketch are placeholders, not a specification for any particular board.

### Modem

- Every HTTP transaction is bracketed by `AT+HTTPTERM`, on success and on every failure path
- `AT+HTTPACTION` responses are parsed tolerantly (see [`at_parse.h`](./firmware/rescue_watch/at_parse.h))
- `AT+CREG?` accepts `1` (home) and `5` (roaming)
- The GPRS bearer is verified with `AT+SAPBR=2,1` rather than trusting `AT+SAPBR=1,1`
- Three consecutive transport failures trigger a full `initGsm()` re-initialisation

### Known limitations

- **The AT layer is blocking.** A modem transaction holds the main loop for up to
  ~30 s in the worst case (waiting for `+HTTPACTION` on a stalled radio). During that
  window the button is not polled and the GPS parser is not fed, so a press made
  mid-transaction is missed and the user gets no LED feedback until it completes. The
  timeouts are bounded and the retry logic recovers, but a press during a stall must be
  repeated. Making the AT layer non-blocking is the main remaining firmware
  improvement; it was left out here because it is a rewrite of the modem driver rather
  than a fix to the reliability defects.
- **One SoftwareSerial listener at a time.** GPS is not read while the modem is
  transmitting (an ESP8266 constraint, not a code choice). Position is therefore sampled
  immediately before each send.
- **No offline persistence.** A pending SOS lives in RAM. If the device loses power
  before the server confirms it, the SOS is lost. Surviving power loss needs the event
  written to flash/RTC memory before the first transmission attempt.

### Required libraries

- `TinyGPS++` by Mikal Hart
- `EspSoftwareSerial` (bundled with the ESP8266 core)

`ArduinoJson` is **not** required — payloads are built with `snprintf` into fixed
buffers to avoid heap fragmentation on long uptimes.

### Porting to ESP32

The sketch targets the ESP8266. An ESP32 port needs a new pin map (`D0`–`D7` are
NodeMCU labels) and should move both peripherals to hardware `Serial1`/`Serial2`, which
removes the one-listener-at-a-time constraint. `at_parse.h` and the state machine are
portable as-is.

---

## Testing without hardware

### Device simulator

```bash
export SEAGUARD_URL=http://localhost:8080
export SEAGUARD_DEVICE_ID=DEV-SIM001
export SEAGUARD_SECRET=<secret from the BMU console>

node simulate.mjs scenario     # sos → 5 location pings → cancel
node simulate.mjs sos high
node simulate.mjs loop 15
```

### Automated tests

```bash
npm test              # ingest failure matrix + firmware parser
npm run test:app      # ingest core only
npm run test:firmware # compiles firmware/rescue_watch/at_parse.h natively and tests it
```

`npm run test:firmware` compiles and runs the real firmware parsing code on the build
machine. It proves nothing about radio behaviour, TLS negotiation, GPS acquisition or
button electrical characteristics — those need a physical device.

### What still requires physical hardware

| Area                | Why it cannot be verified in software                            |
| ------------------- | ----------------------------------------------------------------- |
| SIM800L TLS         | Older modem firmware has no TLS 1.2; the platform requires it      |
| Network registration| Depends on the SIM, carrier and local coverage                     |
| GPRS bearer         | Carrier APN behaviour                                              |
| GPS acquisition     | Antenna, sky view, cold-start time                                 |
| Button electrical   | Contact bounce profile of the fitted switch                        |
| Battery measurement | Requires the assembled divider                                     |
| End-to-end latency  | Cellular round-trip time                                           |

**TLS is the most likely remaining blocker.** SIM800L modules shipped with older
firmware negotiate only TLS 1.0, which modern hosts reject. If `AT+HTTPSSL=1` succeeds
but `AT+HTTPACTION` returns a 6xx code, the modem firmware is the problem — check the
revision with `AT+CGMR` and update it, or terminate TLS at a proxy you control.

---

## Diagnosing "the SOS button does nothing"

Work down this list; each step tells you whether to continue or stop.

```
Press the SOS button
  │
  ├─ 1. Serial console (115200 baud) prints "[seaguard] press -> SOS (LOW)"?
  │      No  → button wiring, or the press was over 3 s and there was no SOS to cancel
  │
  ├─ 2. "[seaguard] location ping skipped — no fresh GPS fix"?
  │      That is fine for /sos — an SOS is sent without a fix. Check the GPS antenna.
  │
  ├─ 3. "[at] AT+CREG? -> +CREG: 0,1" or "0,5"?
  │      No  → SIM, antenna or coverage. Nothing else will work until this passes.
  │
  ├─ 4. "[seaguard] GPRS bearer unavailable"?
  │      Yes → wrong APN in secrets.h, or no data on the SIM
  │
  ├─ 5. "[at] AT+HTTPSSL=1 -> ERROR"?
  │      Yes → modem firmware has no usable TLS (see above)
  │
  ├─ 6. "[seaguard] HTTP status ..." — what is it?
  │      -1   → no +HTTPACTION URC: timeout or modem lockup; watch for the auto re-init
  │      401  → wrong secret in secrets.h. Rotate and re-flash
  │      403  → device disabled in the BMU console
  │      400  → payload rejected; the serial log shows what was sent
  │      5xx  → server side; continue to step 7 with the trace id
  │      200  → the server has it; continue to step 8
  │
  ├─ 7. Server: select from ingest_request_logs
  │      order by created_at desc limit 20;
  │      Matches the trace id? Look at status_code and error_message.
  │      No row at all → the request never arrived (back to step 3)
  │
  ├─ 8. Database: select id, status, started_at, last_lat, last_lng
  │      from sos_alerts order by started_at desc limit 5;
  │      No row → check ingest_request_logs.error_message for the trace id
  │
  ├─ 9. Realtime: the rescue dashboard subscribes to postgres_changes on
  │      sos_alerts. Confirm the table is in the supabase_realtime publication:
  │        select * from pg_publication_tables
  │         where pubname = 'supabase_realtime' and tablename = 'sos_alerts';
  │
  └─ 10. Dashboard: sign in as a rescue_officer. RLS scopes sos_alerts to
         admin / rescue_officer / bmu_officer — a fisherman account sees nothing.
         Reload: if the alert appears on reload but not live, the problem is
         realtime; if it does not appear at all, it is RLS.
```

---

## Provisioning checklist

1. `/bmu` → **Devices** → **Add**
2. Enter the `Device ID` printed on the PCB label
3. Assign the fisherman who will carry it, and the hardware type
4. **Save** — copy the device secret from the one-time panel
5. `cp secrets.example.h secrets.h` and fill in ID, secret, host and APN
6. Flash, then watch the serial console for `[seaguard] modem ready`
7. Within 15 s the device appears as **Active** in the BMU console after its first `/location` ping
8. Press the button once and confirm the incident on `/rescue`

---

## Changes from the previous revision

| Previously documented                    | Reality                                                                 |
| ---------------------------------------- | ----------------------------------------------------------------------- |
| ESP32                                    | ESP8266 / NodeMCU — the pin map and `SoftwareSerial` usage are ESP8266   |
| SSD1306 OLED status display              | Does not exist; there is a status LED                                    |
| "Real battery ADC — not hardcoded"       | Was hardcoded to `80`. Now off by default and omitted unless calibrated  |
| Retry with backoff, 3 attempts           | Did not exist. Now implemented, and SOS retries until confirmed          |
| 48-character secret                      | 64 hex characters, stored as a SHA-256 digest                            |
| Secret readable from the device record   | Shown once at creation or rotation; the column is revoked from browsers  |
| `5xx` on server error                    | Was `400` for database errors. Now correctly `503`                       |
| Single press = LOW, double press = HIGH  | Kept in effect: first press sends `LOW`, a second press escalates to `HIGH` |
| Cancel on long press (1.5 s), any state  | 3 s, and only when an SOS is actually open                               |
