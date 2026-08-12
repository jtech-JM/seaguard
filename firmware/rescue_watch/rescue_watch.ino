// ------------------------------------------------------------
// SEAGUARD rescue watch firmware
// ESP8266 (NodeMCU) + NEO-6M GPS + SIM800L  ->  SEAGUARD ingest API
//
// Target board: NodeMCU 1.0 (ESP-12E). Both peripherals sit on SoftwareSerial
// because UART0 is the USB console and UART1 is transmit-only on the ESP8266.
// Only one SoftwareSerial instance can receive at a time, so the GPS parser is
// fed whenever the modem is idle and the position is sampled immediately before
// each transmission. Porting to an ESP32 (two spare hardware UARTs) would remove
// that constraint but needs a new pin map — see HARDWARE_INTEGRATION.md.
//
// Behaviour, in one place (docs are reconciled against this):
//   * short press            -> SOS at level LOW
//   * second press while an SOS is open -> escalates that SOS to level HIGH
//   * long press (>= 3 s) while an SOS is open -> cancel (false alarm)
//   * long press with no SOS open -> ignored, so panic-holding the button
//     can never cancel the alert it just raised
//   * location ping every 15 s, whether or not an SOS is active
//   * an SOS retries with capped exponential backoff until the server confirms
//     it; it is never silently dropped
// ------------------------------------------------------------
#include <SoftwareSerial.h>
#include <TinyGPS++.h>
#include <stdarg.h>

// `secrets.h` is git-ignored. Copy secrets.example.h to secrets.h and fill it in.
#include "secrets.h"
// AT response parsing, kept Arduino-free so it can be unit-tested on a host.
#include "at_parse.h"

// ----- PIN DEFINITIONS -----
// Unchanged from the deployed wiring — do not renumber without rewiring.
// The SoftwareSerial constructor takes (receivePin, transmitPin) as seen by the
// ESP8266, so SIM800_RX_PIN is the ESP pin wired to the modem's TX line.
const int BUTTON_PIN = D5;     // GPIO14, push button to GND
const int LED_PIN = D0;        // GPIO16, status LED
const int SIM800_RX_PIN = D2;  // GPIO4  <- SIM800L TX
const int SIM800_TX_PIN = D1;  // GPIO5  -> SIM800L RX
const int GPS_RX_PIN = D6;     // GPIO12 <- GPS TX
const int GPS_TX_PIN = D7;     // GPIO13 -> GPS RX

// ----- TUNING -----
const unsigned long LOCATION_INTERVAL_MS = 15000;  // documented ping cadence
const unsigned long DEBOUNCE_MS = 50;
const unsigned long LONG_PRESS_MS = 3000;  // hold to cancel an open SOS
const unsigned long GPS_MAX_AGE_MS = 60000;  // older than this counts as stale
const unsigned long SOS_RETRY_BASE_MS = 2000;
const unsigned long SOS_RETRY_MAX_MS = 60000;
const uint8_t MODEM_FAILURES_BEFORE_REINIT = 3;
const size_t AT_RESPONSE_LIMIT = 512;  // cap so a chatty modem cannot exhaust RAM

// Battery sensing is OFF by default. Reporting a fabricated percentage is worse
// than reporting none: the BMU console would show a healthy battery for a device
// that is about to die. Enable this only after fitting and measuring a divider,
// then set the two constants below from that measurement.
#define BATTERY_SENSE_ENABLED 0
const float BATTERY_DIVIDER_FULL_SCALE_V = 4.2f;  // pack voltage at ADC full scale
const float BATTERY_EMPTY_V = 3.3f;               // cut-off voltage for 0%

// ----- SERIAL INTERFACES -----
SoftwareSerial sim800(SIM800_RX_PIN, SIM800_TX_PIN);
SoftwareSerial gpsSerial(GPS_RX_PIN, GPS_TX_PIN);
TinyGPSPlus gps;

// ----- STATE -----
bool sosActive = false;          // an SOS has been confirmed by the server
bool sosPending = false;         // an SOS is queued and not yet confirmed
char sosEventId[40] = {0};       // idempotency key, stable across retries
const char* sosLevel = "LOW";
uint8_t sosAttempts = 0;
unsigned long sosNextAttemptAt = 0;

bool cancelPending = false;

unsigned long lastLocationSend = 0;
uint8_t consecutiveModemFailures = 0;
bool gsmReady = false;
uint32_t eventCounter = 0;

#ifdef SEAGUARD_CA_CERT
// Path the trust anchor is written to inside the modem's own filesystem.
#ifndef SEAGUARD_CA_CERT_PATH
#define SEAGUARD_CA_CERT_PATH "C:\\USER\\seaguard-ca.crt"
#endif
// Cleared on every modem (re)initialisation — a modem reset loses the file.
bool caCertReady = false;
#endif

// Button
int lastRawButton = HIGH;
int stableButton = HIGH;
unsigned long lastButtonChangeAt = 0;
unsigned long pressStartedAt = 0;
bool longPressHandled = false;

// LED
unsigned long lastBlinkAt = 0;
bool ledOn = false;

// ----- FORWARD DECLARATIONS -----
void feedGps();
bool gpsHasFreshFix();
int readBatteryPercent();
void handleButton();
void updateLed();
void makeEventId(char* out, size_t len);
size_t buildTelemetryJson(char* out, size_t len, const char* extraKey, const char* extraValue);
String readUntil(const char* token, unsigned long timeoutMs);
bool sendAt(const char* command, const char* expected, unsigned long timeoutMs);
bool initGsm();
bool bearerIsOpen();
bool ensureBearer();
bool ensureCaCert();
int postJson(const char* path, const char* payload);
void queueSos(const char* level);
void serviceSos();
void serviceCancel();
void serviceLocation();

// ============================================================
// SETUP / LOOP
// ============================================================

void setup() {
  Serial.begin(115200);
  delay(100);
  sim800.begin(9600);
  gpsSerial.begin(9600);

  pinMode(BUTTON_PIN, INPUT_PULLUP);
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);

  Serial.println();
  Serial.println(F("[seaguard] boot"));
  Serial.print(F("[seaguard] device_id="));
  Serial.println(SEAGUARD_DEVICE_ID);
  Serial.print(F("[seaguard] host="));
  Serial.println(SEAGUARD_HOST);
  // The secret is never printed, at any log level.

  gsmReady = initGsm();
  Serial.println(gsmReady ? F("[seaguard] modem ready") : F("[seaguard] modem init FAILED"));
  Serial.println(F("[seaguard] short press = SOS, hold 3s = cancel an open SOS"));

  gpsSerial.listen();
  lastLocationSend = millis();
}

void loop() {
  feedGps();
  handleButton();
  updateLed();

  // Cancel first: it is the user asking to stand down, and it also clears any
  // pending SOS retry so the two can never fight each other.
  serviceCancel();
  serviceSos();
  serviceLocation();
}

// ============================================================
// GPS
// ============================================================

void feedGps() {
  // Only one SoftwareSerial can receive at a time; skip while the modem holds
  // the port rather than corrupting an in-flight AT transaction.
  if (!gpsSerial.isListening()) return;
  while (gpsSerial.available() > 0) {
    gps.encode(gpsSerial.read());
  }
}

bool gpsHasFreshFix() {
  if (!gps.location.isValid()) return false;
  if (gps.location.age() > GPS_MAX_AGE_MS) return false;
  // TinyGPS++ reports 0,0 before the first fix; the API rejects it as "no fix"
  // but filtering here keeps a meaningless position off the air entirely.
  if (gps.location.lat() == 0.0 && gps.location.lng() == 0.0) return false;
  return true;
}

// ============================================================
// BATTERY
// ============================================================

// Returns 0-100, or -1 when the device cannot measure its battery. Callers omit
// the `battery` field entirely when this returns -1.
int readBatteryPercent() {
#if BATTERY_SENSE_ENABLED
  // NodeMCU A0 reads 0-3.3 V through its on-board divider, mapped to 0-1023.
  // BATTERY_DIVIDER_FULL_SCALE_V must be measured on the assembled board.
  const int raw = analogRead(A0);
  const float volts = (raw / 1023.0f) * BATTERY_DIVIDER_FULL_SCALE_V;
  const float span = BATTERY_DIVIDER_FULL_SCALE_V - BATTERY_EMPTY_V;
  if (span <= 0.0f) return -1;
  int pct = (int)(((volts - BATTERY_EMPTY_V) / span) * 100.0f);
  if (pct < 0) pct = 0;
  if (pct > 100) pct = 100;
  return pct;
#else
  return -1;
#endif
}

// ============================================================
// BUTTON
// ============================================================

void handleButton() {
  const int raw = digitalRead(BUTTON_PIN);
  const unsigned long now = millis();

  if (raw != lastRawButton) {
    lastRawButton = raw;
    lastButtonChangeAt = now;
    return;  // wait for the level to settle
  }
  if (now - lastButtonChangeAt < DEBOUNCE_MS) return;
  if (raw == stableButton) {
    // Held down: fire the long-press action once, at the threshold, so the user
    // gets feedback without having to guess when to let go.
    if (stableButton == LOW && !longPressHandled && now - pressStartedAt >= LONG_PRESS_MS) {
      longPressHandled = true;
      if (sosActive || sosPending) {
        Serial.println(F("[seaguard] long press -> cancel"));
        cancelPending = true;
      } else {
        // Nothing to cancel. Ignoring this is deliberate: holding the button
        // during an emergency must never send a cancel.
        Serial.println(F("[seaguard] long press ignored (no active SOS)"));
      }
    }
    return;
  }

  stableButton = raw;
  if (raw == LOW) {
    pressStartedAt = now;
    longPressHandled = false;
    return;
  }

  // Released. A long press has already been handled on the way down.
  if (longPressHandled) return;

  if (sosActive || sosPending) {
    // Second press on an open incident escalates it. The server treats a repeat
    // /sos for an open alert as an update, so this raises the level in place
    // rather than opening a second incident.
    Serial.println(F("[seaguard] press -> escalate to HIGH"));
    queueSos("HIGH");
  } else {
    Serial.println(F("[seaguard] press -> SOS (LOW)"));
    queueSos("LOW");
  }
}

void updateLed() {
  const unsigned long now = millis();
  if (sosPending) {
    // Fast blink: trying to reach the server.
    if (now - lastBlinkAt >= 200) {
      lastBlinkAt = now;
      ledOn = !ledOn;
      digitalWrite(LED_PIN, ledOn ? HIGH : LOW);
    }
  } else if (sosActive) {
    digitalWrite(LED_PIN, HIGH);  // solid: the server has the alert
    ledOn = true;
  } else {
    digitalWrite(LED_PIN, LOW);
    ledOn = false;
  }
}

// ============================================================
// PAYLOADS
// ============================================================

static uint32_t deviceChipId() {
#if defined(ESP8266)
  return ESP.getChipId();
#elif defined(ESP32)
  return (uint32_t)(ESP.getEfuseMac() & 0xFFFFFFFF);
#else
  return 0;
#endif
}

void makeEventId(char* out, size_t len) {
  // Unique per SOS event and stable across retries, so the server can
  // deduplicate a retry whose response was lost.
  snprintf(out, len, "%08lx-%lu-%lu", (unsigned long)deviceChipId(), (unsigned long)millis(),
           (unsigned long)(++eventCounter));
}

// Appends to `out`, advancing `n`. snprintf returns the length it *would* have
// written, so appending its return value blindly walks the cursor past the end
// of the buffer and the next call's `len - n` underflows. Truncation is clamped
// here instead.
static void appendJson(char* out, size_t len, size_t& n, const char* format, ...) {
  if (n >= len - 1) return;
  va_list args;
  va_start(args, format);
  const int written = vsnprintf(out + n, len - n, format, args);
  va_end(args);
  if (written < 0) return;
  n = ((size_t)written >= len - n) ? len - 1 : n + (size_t)written;
}

// Builds the JSON body shared by /sos and /location into a caller-owned buffer.
// Fixed buffers and snprintf throughout: heap fragmentation from repeated String
// concatenation is a real cause of long-uptime failures on the ESP8266.
size_t buildTelemetryJson(char* out, size_t len, const char* extraKey, const char* extraValue) {
  const bool haveFix = gpsHasFreshFix();
  const int battery = readBatteryPercent();
  size_t n = 0;

  appendJson(out, len, n, "{\"device_id\":\"%s\"", SEAGUARD_DEVICE_ID);

  if (haveFix) {
    char latBuf[16];
    char lngBuf[16];
    char accBuf[16];
    dtostrf(gps.location.lat(), 0, 6, latBuf);
    dtostrf(gps.location.lng(), 0, 6, lngBuf);
    dtostrf(gps.hdop.isValid() ? gps.hdop.hdop() : 99.0, 0, 1, accBuf);
    appendJson(out, len, n, ",\"lat\":%s,\"lng\":%s,\"accuracy\":%s,\"gps_fix\":true", latBuf, lngBuf,
               accBuf);
  } else {
    // Coordinates are omitted rather than faked. /sos accepts an SOS without a
    // fix; /location skips the ping entirely (see serviceLocation).
    appendJson(out, len, n, ",\"gps_fix\":false");
  }

  if (battery >= 0) appendJson(out, len, n, ",\"battery\":%d", battery);
  if (extraKey != NULL && extraValue != NULL) {
    appendJson(out, len, n, ",\"%s\":\"%s\"", extraKey, extraValue);
  }
  appendJson(out, len, n, "}");
  return n;
}

// ============================================================
// MODEM: AT LAYER
// ============================================================

// Reads until `token` appears, "ERROR" appears, or the timeout expires.
// Returns as soon as the token is seen — the previous implementation always
// burned the full timeout, which made every request several seconds slower than
// it needed to be.
String readUntil(const char* token, unsigned long timeoutMs) {
  String response;
  response.reserve(96);
  const unsigned long deadline = millis() + timeoutMs;
  while ((long)(millis() - deadline) < 0) {
    while (sim800.available()) {
      const char c = (char)sim800.read();
      if (response.length() < AT_RESPONSE_LIMIT) response += c;
      if (token != NULL && response.indexOf(token) != -1) return response;
      if (response.indexOf("ERROR") != -1) return response;
    }
    yield();  // keep the ESP8266 watchdog and WiFi stack happy
  }
  return response;
}

bool sendAt(const char* command, const char* expected, unsigned long timeoutMs) {
  while (sim800.available()) sim800.read();  // drop stale URCs before commanding
  sim800.println(command);
  const String response = readUntil(expected, timeoutMs);

  // The auth header is passed as an AT parameter, so the raw command contains
  // the device secret. Serial output is a diagnostic channel that gets pasted
  // into bug reports — it never sees the credential.
  Serial.print(F("[at] "));
  if (strstr(command, "x-device-secret") != NULL) {
    Serial.print(F("AT+HTTPPARA=\"USERDATA\",\"x-device-secret: <redacted>\""));
  } else {
    Serial.print(command);
  }
  Serial.print(F(" -> "));
  if (response.length() > 0) {
    Serial.println(response);
  } else {
    Serial.println(F("(no response)"));
  }
  return response.indexOf(expected) != -1;
}

bool initGsm() {
  sim800.listen();
  gsmReady = false;
#ifdef SEAGUARD_CA_CERT
  // The certificate lives in the modem's filesystem, which a reset clears, so
  // reinstall it rather than trusting a flag that outlived the modem.
  caCertReady = false;
#endif

  if (!sendAt("AT", "OK", 3000)) {
    gpsSerial.listen();
    return false;
  }
  sendAt("ATE0", "OK", 2000);       // echo off; failure here is not fatal
  sendAt("AT+CMEE=2", "OK", 2000);  // verbose errors, for the serial diagnostics

  if (!sendAt("AT+CPIN?", "READY", 5000)) {
    Serial.println(F("[seaguard] SIM not ready"));
    gpsSerial.listen();
    return false;
  }

  // Registration can take tens of seconds from cold. Accept both "registered,
  // home" (0,1) and "registered, roaming" (0,5) — a roaming SIM is still usable
  // and the old firmware rejected it outright.
  bool registered = false;
  for (uint8_t i = 0; i < 30 && !registered; i++) {
    while (sim800.available()) sim800.read();
    sim800.println("AT+CREG?");
    if (seaguard::parseRegistered(readUntil("OK", 2000).c_str())) registered = true;
    else delay(1000);
  }
  if (!registered) {
    Serial.println(F("[seaguard] not registered on the network"));
    gpsSerial.listen();
    return false;
  }

  const bool bearer = ensureBearer();
  gpsSerial.listen();
  gsmReady = bearer;
  return bearer;
}

bool bearerIsOpen() {
  while (sim800.available()) sim800.read();
  sim800.println("AT+SAPBR=2,1");
  return seaguard::parseBearerConnected(readUntil("OK", 5000).c_str());
}

bool ensureBearer() {
  if (bearerIsOpen()) return true;

  sendAt("AT+SAPBR=3,1,\"Contype\",\"GPRS\"", "OK", 5000);

  char cmd[96];
  snprintf(cmd, sizeof(cmd), "AT+SAPBR=3,1,\"APN\",\"%s\"", SEAGUARD_APN);
  sendAt(cmd, "OK", 5000);

  if (strlen(SEAGUARD_APN_USER) > 0) {
    snprintf(cmd, sizeof(cmd), "AT+SAPBR=3,1,\"USER\",\"%s\"", SEAGUARD_APN_USER);
    sendAt(cmd, "OK", 5000);
  }
  if (strlen(SEAGUARD_APN_PASS) > 0) {
    snprintf(cmd, sizeof(cmd), "AT+SAPBR=3,1,\"PWD\",\"%s\"", SEAGUARD_APN_PASS);
    sendAt(cmd, "OK", 5000);
  }

  // Opening an already-open bearer answers ERROR, so verify state either way
  // instead of trusting the command's own result.
  sendAt("AT+SAPBR=1,1", "OK", 30000);
  return bearerIsOpen();
}

// ============================================================
// MODEM: TLS TRUST ANCHOR
// ============================================================
//
// AT+HTTPSSL=1 encrypts the session but does NOT authenticate the server: with
// no trust anchor loaded the SIM800L accepts any certificate presented to it.
// An attacker able to intercept the GPRS path can then terminate the TLS
// session, read the device secret out of the request header, and use it to
// forge /cancel against a live distress alert.
//
// Loading the deployment's CA closes that. It is opt-in at flash time because
// the correct anchor depends on who issues the server's certificate, and a
// wrong one takes the device off the air entirely:
//
//   * SEAGUARD_CA_CERT defined  -> the certificate is installed and every
//     transmission is refused until that succeeds. Authenticated TLS.
//   * SEAGUARD_CA_CERT absent   -> previous behaviour, plus a loud warning.
//     Encrypted, unauthenticated, and MITM-able. Not fit for production.
//
// Note that the SIM800L's TLS stack is old; builds before firmware 1418B05 top
// out at TLS 1.0 and will fail the handshake against a modern host regardless
// of the trust anchor. See HARDWARE_INTEGRATION.md.

#ifdef SEAGUARD_CA_CERT

// Writes the CA to the modem filesystem and registers it as the trust anchor.
// Returns false unless the modem explicitly confirms it was accepted.
bool ensureCaCert() {
  if (caCertReady) return true;

  const char* pem = SEAGUARD_CA_CERT;
  const size_t pemLength = strlen(pem);
  if (pemLength == 0) {
    Serial.println(F("[seaguard] SEAGUARD_CA_CERT is empty — refusing to transmit"));
    return false;
  }

  char cmd[160];

  // FSCREATE on an existing path answers ERROR; the following FSWRITE
  // overwrites from offset 0 either way, so the result is not checked.
  snprintf(cmd, sizeof(cmd), "AT+FSCREATE=%s", SEAGUARD_CA_CERT_PATH);
  sendAt(cmd, "OK", 5000);

  // AT+FSWRITE=<path>,<mode 0=overwrite>,<length>,<input timeout seconds>
  snprintf(cmd, sizeof(cmd), "AT+FSWRITE=%s,0,%u,10", SEAGUARD_CA_CERT_PATH,
           (unsigned)pemLength);
  while (sim800.available()) sim800.read();
  sim800.println(cmd);
  if (!seaguard::parseWritePrompt(readUntil(">", 10000).c_str())) {
    Serial.println(F("[seaguard] modem refused the CA write prompt"));
    return false;
  }
  sim800.write((const uint8_t*)pem, pemLength);
  if (readUntil("OK", 15000).indexOf("OK") == -1) {
    Serial.println(F("[seaguard] CA certificate write failed"));
    return false;
  }

  snprintf(cmd, sizeof(cmd), "AT+SSLSETCERT=\"%s\"", SEAGUARD_CA_CERT_PATH);
  while (sim800.available()) sim800.read();
  sim800.println(cmd);
  // The result arrives as a URC after the command's own OK, so wait for it
  // specifically rather than returning on the OK.
  const int result = seaguard::parseSslSetCertResult(readUntil("+SSLSETCERT:", 10000).c_str());
  if (result != 0) {
    // -1 means the modem never reported a result. Unconfirmed is not accepted:
    // continuing would mean claiming a verified channel we cannot demonstrate.
    Serial.print(F("[seaguard] CA certificate rejected by the modem, result "));
    Serial.println(result);
    return false;
  }

  Serial.println(F("[seaguard] CA certificate installed — server identity will be verified"));
  caCertReady = true;
  return true;
}

#else  // SEAGUARD_CA_CERT not provided

bool ensureCaCert() {
  static bool warned = false;
  if (!warned) {
    warned = true;
    Serial.println(F("[seaguard] WARNING: no SEAGUARD_CA_CERT — TLS is encrypted but the"));
    Serial.println(F("[seaguard] server is NOT authenticated. Traffic can be intercepted"));
    Serial.println(F("[seaguard] and the device secret captured. Do not deploy like this."));
  }
  return true;
}

#endif  // SEAGUARD_CA_CERT

// ============================================================
// MODEM: HTTP
// ============================================================

// Returns the HTTP status code, or -1 for a transport-level failure.
//
// Every exit path runs AT+HTTPTERM. The SIM800L allows exactly one HTTP session;
// leaving one open makes the *next* AT+HTTPINIT answer ERROR. That was the root
// cause of SOS events never reaching the server: the 15-second location ping
// consumed the only session, and every request afterwards — including the SOS —
// aborted at HTTPINIT before a single byte went out.
int postJson(const char* path, const char* payload) {
  sim800.listen();
  int result = -1;

  // Clear any session left behind by a previous failure. This is expected to
  // answer ERROR when no session is open, which is fine.
  sendAt("AT+HTTPTERM", "OK", 3000);

  do {
    if (!ensureBearer()) {
      Serial.println(F("[seaguard] GPRS bearer unavailable"));
      break;
    }
    if (!sendAt("AT+HTTPINIT", "OK", 10000)) break;
    if (!sendAt("AT+HTTPPARA=\"CID\",1", "OK", 5000)) break;
    if (!sendAt("AT+HTTPSSL=1", "OK", 5000)) {
      // Older SIM800L firmware has no usable TLS stack. Surface it plainly
      // rather than silently falling back to plaintext over the air.
      Serial.println(F("[seaguard] HTTPSSL rejected — modem firmware may not support TLS"));
      break;
    }

    // Same reasoning one layer up: an encrypted session to an unverified peer
    // is not a secure one, so a build that asks for a trust anchor does not
    // transmit without it.
    if (!ensureCaCert()) break;

    char cmd[256];
    snprintf(cmd, sizeof(cmd), "AT+HTTPPARA=\"URL\",\"https://%s%s\"", SEAGUARD_HOST, path);
    if (!sendAt(cmd, "OK", 5000)) break;

    if (!sendAt("AT+HTTPPARA=\"CONTENT\",\"application/json\"", "OK", 5000)) break;

    snprintf(cmd, sizeof(cmd), "AT+HTTPPARA=\"USERDATA\",\"x-device-secret: %s\"",
             SEAGUARD_DEVICE_SECRET);
    if (!sendAt(cmd, "OK", 5000)) break;  // sendAt redacts the secret before logging

    const size_t length = strlen(payload);
    snprintf(cmd, sizeof(cmd), "AT+HTTPDATA=%u,10000", (unsigned)length);
    while (sim800.available()) sim800.read();
    sim800.println(cmd);
    if (readUntil("DOWNLOAD", 10000).indexOf("DOWNLOAD") == -1) break;

    sim800.write((const uint8_t*)payload, length);
    if (readUntil("OK", 10000).indexOf("OK") == -1) break;

    while (sim800.available()) sim800.read();
    sim800.println("AT+HTTPACTION=1");
    // The modem acknowledges with OK, then delivers +HTTPACTION asynchronously.
    readUntil("OK", 5000);
    const String action = readUntil("+HTTPACTION:", 30000);
    result = seaguard::parseHttpActionStatus(action.c_str());
    Serial.print(F("[seaguard] HTTP status "));
    Serial.println(result);
  } while (false);

  // Always tear the session down, on success and on every break above.
  sendAt("AT+HTTPTERM", "OK", 5000);
  gpsSerial.listen();

  if (result < 0) {
    if (++consecutiveModemFailures >= MODEM_FAILURES_BEFORE_REINIT) {
      Serial.println(F("[seaguard] repeated modem failures — reinitialising"));
      consecutiveModemFailures = 0;
      initGsm();
    }
  } else {
    consecutiveModemFailures = 0;
  }
  return result;
}

// 2xx means the server understood us; 4xx (except 429) is permanent; 5xx and
// transport failures are worth retrying. Defined in at_parse.h so the retry
// policy is covered by the host-side tests.
using seaguard::isAccepted;
using seaguard::isPermanentRejection;

// ============================================================
// EVENT SERVICING
// ============================================================

// Called only from a button press. Each press is a distinct device event, so it
// gets its own event_id; retries of that press reuse it (see serviceSos).
//
// Minting a fresh id per press matters for escalation: the server short-circuits
// on a known event_id and returns the existing alert unchanged, so re-sending
// the first press's id with level HIGH would be treated as a duplicate and the
// escalation would be silently dropped. With a new id the request falls through
// to the open-alert path, which updates the level in place.
void queueSos(const char* level) {
  sosLevel = level;
  makeEventId(sosEventId, sizeof(sosEventId));
  sosAttempts = 0;
  sosNextAttemptAt = millis();  // transmit on the next loop pass
  sosPending = true;
  cancelPending = false;  // a new SOS supersedes an unsent cancel
}

void serviceSos() {
  if (!sosPending) return;
  if ((long)(millis() - sosNextAttemptAt) < 0) return;

  char payload[288];
  size_t n = buildTelemetryJson(payload, sizeof(payload), "level", sosLevel);
  // Splice the idempotency key in, replacing the closing brace.
  if (n > 0 && payload[n - 1] == '}' && sizeof(payload) - n > sizeof(sosEventId) + 16) {
    n -= 1;
    appendJson(payload, sizeof(payload), n, ",\"event_id\":\"%s\"}", sosEventId);
  }

  Serial.print(F("[seaguard] SOS attempt "));
  Serial.println(sosAttempts + 1);
  const int status = postJson("/api/public/ingest/sos", payload);

  if (isAccepted(status)) {
    sosPending = false;
    sosActive = true;
    sosAttempts = 0;
    lastLocationSend = millis();  // the SOS already carried a fresh position
    Serial.println(F("[seaguard] SOS confirmed by server"));
    return;
  }

  if (isPermanentRejection(status)) {
    // 401/403/400 will not improve by repeating. Stop, and make the failure
    // visible on the serial console rather than looping forever.
    sosPending = false;
    Serial.print(F("[seaguard] SOS REJECTED (HTTP "));
    Serial.print(status);
    Serial.println(F(") — check device credentials / device enabled in BMU console"));
    return;
  }

  // Transient: retry with capped exponential backoff, indefinitely. A distress
  // call is never abandoned because the network was briefly unavailable.
  sosAttempts++;
  unsigned long delayMs = SOS_RETRY_BASE_MS << (sosAttempts > 5 ? 5 : sosAttempts - 1);
  if (delayMs > SOS_RETRY_MAX_MS) delayMs = SOS_RETRY_MAX_MS;
  sosNextAttemptAt = millis() + delayMs;
  Serial.print(F("[seaguard] SOS not confirmed — retrying in "));
  Serial.print(delayMs / 1000);
  Serial.println(F("s"));
}

void serviceCancel() {
  if (!cancelPending) return;

  char payload[160];
  snprintf(payload, sizeof(payload), "{\"device_id\":\"%s\",\"reason\":\"Cancelled from device\"}",
           SEAGUARD_DEVICE_ID);

  const int status = postJson("/api/public/ingest/cancel", payload);
  if (isAccepted(status)) {
    cancelPending = false;
    sosPending = false;
    sosActive = false;
    Serial.println(F("[seaguard] cancel confirmed"));
  } else if (isPermanentRejection(status)) {
    cancelPending = false;
    Serial.print(F("[seaguard] cancel rejected (HTTP "));
    Serial.print(status);
    Serial.println(F(")"));
  }
  // Transient failure: leave cancelPending set and retry on the next loop pass.
}

void serviceLocation() {
  if (millis() - lastLocationSend < LOCATION_INTERVAL_MS) return;
  // Do not interleave a routine ping with an unconfirmed SOS — the emergency
  // gets the radio first.
  if (sosPending || cancelPending) return;

  lastLocationSend = millis();
  if (!gpsHasFreshFix()) {
    Serial.println(F("[seaguard] location ping skipped — no fresh GPS fix"));
    return;
  }

  char payload[224];
  buildTelemetryJson(payload, sizeof(payload), NULL, NULL);
  const int status = postJson("/api/public/ingest/location", payload);

  if (status == 403) {
    Serial.println(F("[seaguard] device disabled in BMU console"));
  } else if (!isAccepted(status)) {
    // Dropped on purpose: the next ping is 15 s away and carries a newer
    // position, so there is nothing worth queueing.
    Serial.println(F("[seaguard] location ping failed (will retry on next interval)"));
  }
}
