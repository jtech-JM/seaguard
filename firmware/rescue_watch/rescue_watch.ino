/********************************************************************
 * SEAGUARD — Rescue Watch Firmware
 * Hardware:
 *   - ESP32
 *   - SIM800L (GSM/GPRS)
 *   - GPS Module (UART, NMEA)
 *   - SSD1306 OLED 128x64 (I2C)
 *   - SOS Button  (single press = LOW, double press = HIGH,
 *                  long press while SOS active = Cancel)
 *   - Red LED  (SOS active)
 *   - Green LED (ready / normal)
 *
 * Libraries required (Arduino Library Manager):
 *   - TinyGPS++        by Mikal Hart
 *   - ArduinoJson      by Benoit Blanchon
 *   - Adafruit SSD1306 by Adafruit
 *   - Adafruit GFX     by Adafruit
 *
 * Author: Blue Data Rescue System
 *******************************************************************/

#include <Arduino.h>
#include <HardwareSerial.h>
#include <TinyGPS++.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

// ================================================================
// CONFIGURATION — flash these per device from the BMU console
// ================================================================
const char* DEVICE_ID     = "DEV-ABC123";           // from BMU console
const char* DEVICE_SECRET = "YOUR_48_CHARACTER_SECRET_HERE";
const char* HOST          = "seaguardb.vercel.app"; // live Vercel host

// ================================================================
// PIN ASSIGNMENTS
// ================================================================
#define SOS_BUTTON_PIN      14
#define RED_LED_PIN         26
#define GREEN_LED_PIN       25
#define BATTERY_ADC_PIN     34   // voltage divider: batt+ → 100k → pin → 100k → GND

// I2C OLED (SDA/SCL use ESP32 defaults: GPIO21/GPIO22)
#define OLED_WIDTH          128
#define OLED_HEIGHT         64
#define OLED_RESET          -1   // shared reset with MCU
#define OLED_I2C_ADDR       0x3C

// UART
#define GPS_RX_PIN          16
#define GPS_TX_PIN          17
#define GSM_RX_PIN          4
#define GSM_TX_PIN          2

// ================================================================
// TIMING
// ================================================================
const uint32_t LOCATION_INTERVAL_MS = 15000;   // GPS ping every 15 s
const uint32_t DOUBLE_CLICK_MS      = 500;     // second-press window → HIGH
const uint32_t LONG_PRESS_MS        = 2000;    // hold 2s while SOS active → cancel
const uint32_t DEBOUNCE_MS          = 40;
const uint32_t AT_TIMEOUT_MS        = 5000;
const uint8_t  HTTP_RETRIES         = 3;

// ================================================================
// ENUMS & STRUCTS
// ================================================================
enum DeviceState { STATE_BOOT, STATE_READY, STATE_SOS_ACTIVE };
enum SosLevel    { SOS_LOW, SOS_HIGH };

struct GPSData {
  double lat;
  double lng;
  float  accuracy;
  int    satellites;
  bool   valid;
};

// ================================================================
// GLOBALS
// ================================================================
DeviceState   state         = STATE_BOOT;
SosLevel      sosLevel      = SOS_LOW;
bool          sosActive     = false;
unsigned long firstPressAt  = 0;
unsigned long lastLocationAt = 0;
bool          waitingSecond = false;

TinyGPSPlus          gpsParser;
HardwareSerial        gpsSerial(1);   // UART1
HardwareSerial        gsmSerial(2);   // UART2
Adafruit_SSD1306      oled(OLED_WIDTH, OLED_HEIGHT, &Wire, OLED_RESET);

// ================================================================
// OLED DISPLAY
// ================================================================
void displayInit() {
  if (!oled.begin(SSD1306_SWITCHCAPVCC, OLED_I2C_ADDR)) {
    Serial.println("[OLED] Init failed — check wiring");
    return;
  }
  oled.clearDisplay();
  oled.setTextColor(SSD1306_WHITE);
  oled.setTextSize(1);
  oled.setCursor(0, 0);
  oled.println("SEAGUARD");
  oled.println("Initialising...");
  oled.display();
}

void displayReady() {
  oled.clearDisplay();
  oled.setTextSize(1);
  oled.setCursor(0, 0);
  oled.println("SEAGUARD");
  oled.drawLine(0, 10, 127, 10, SSD1306_WHITE);
  oled.setCursor(0, 16);
  oled.println("Status: READY");
  oled.setCursor(0, 28);
  oled.println("1x press = LOW alert");
  oled.setCursor(0, 38);
  oled.println("2x press = HIGH alert");
  oled.setCursor(0, 50);
  oled.println("Hold 2s = Cancel SOS");
  oled.display();
}

void displaySending() {
  oled.clearDisplay();
  oled.setTextSize(1);
  oled.setCursor(0, 0);
  oled.println("SEAGUARD");
  oled.drawLine(0, 10, 127, 10, SSD1306_WHITE);
  oled.setCursor(0, 20);
  oled.println("Sending SOS...");
  oled.display();
}

void displayActive(SosLevel level, int battery) {
  oled.clearDisplay();
  oled.setTextSize(1);
  oled.setCursor(0, 0);
  oled.println("SEAGUARD");
  oled.drawLine(0, 10, 127, 10, SSD1306_WHITE);

  oled.setTextSize(2);
  oled.setCursor(0, 16);
  oled.println("SOS ACTIVE");

  oled.setTextSize(1);
  oled.setCursor(0, 40);
  oled.print("Level: ");
  oled.println(level == SOS_HIGH ? "HIGH" : "LOW");
  oled.setCursor(0, 52);
  oled.print("Battery: ");
  oled.print(battery);
  oled.println("%");
  oled.display();
}

void displayCancel() {
  oled.clearDisplay();
  oled.setTextSize(1);
  oled.setCursor(0, 0);
  oled.println("SEAGUARD");
  oled.drawLine(0, 10, 127, 10, SSD1306_WHITE);
  oled.setCursor(0, 24);
  oled.println("SOS Cancelled");
  oled.setCursor(0, 38);
  oled.println("Status: SAFE");
  oled.display();
}

// Shown while the user is still holding the button
void displayCancelling(uint32_t heldMs) {
  uint8_t pct  = (uint8_t)min((heldMs * 100UL / LONG_PRESS_MS), 100UL);
  uint8_t barW = pct; // progress bar width out of 100px
  oled.clearDisplay();
  oled.setTextSize(1);
  oled.setCursor(0, 0);
  oled.println("SEAGUARD  SOS ACTIVE");
  oled.drawLine(0, 10, 127, 10, SSD1306_WHITE);
  oled.setCursor(0, 20);
  oled.println("Hold to cancel...");
  // progress bar
  oled.drawRect(14, 36, 100, 10, SSD1306_WHITE);
  oled.fillRect(14, 36, barW, 10, SSD1306_WHITE);
  oled.setCursor(0, 54);
  oled.println("Release = keep SOS");
  oled.display();
}

void displayNoGPS() {
  oled.clearDisplay();
  oled.setTextSize(1);
  oled.setCursor(0, 0);
  oled.println("SEAGUARD");
  oled.drawLine(0, 10, 127, 10, SSD1306_WHITE);
  oled.setCursor(0, 20);
  oled.println("WARNING:");
  oled.setCursor(0, 32);
  oled.println("No GPS fix");
  oled.setCursor(0, 44);
  oled.println("Sending anyway...");
  oled.display();
}

void displayError() {
  oled.clearDisplay();
  oled.setTextSize(1);
  oled.setCursor(0, 0);
  oled.println("SEAGUARD");
  oled.drawLine(0, 10, 127, 10, SSD1306_WHITE);
  oled.setCursor(0, 20);
  oled.println("SEND FAILED");
  oled.setCursor(0, 32);
  oled.println("Check signal...");
  oled.display();
}

// Update GPS info on display while SOS is active
void displayGPSStatus(GPSData& g) {
  oled.clearDisplay();
  oled.setTextSize(1);
  oled.setCursor(0, 0);
  oled.println("SEAGUARD  SOS ACTIVE");
  oled.drawLine(0, 10, 127, 10, SSD1306_WHITE);
  oled.setCursor(0, 14);
  oled.print("Lat: ");
  oled.println(g.lat, 5);
  oled.setCursor(0, 24);
  oled.print("Lng: ");
  oled.println(g.lng, 5);
  oled.setCursor(0, 34);
  oled.print("Acc: ");
  oled.print(g.accuracy, 1);
  oled.println("m");
  oled.setCursor(0, 44);
  oled.print("Sats: ");
  oled.print(g.satellites);
  oled.print("  Bat: ");
  oled.print(readBatteryPercent());
  oled.println("%");
  oled.setCursor(0, 56);
  oled.println("Hold btn 2s to cancel");
  oled.display();
}

// ================================================================
// LEDs
// ================================================================
void setLED(bool red, bool green) {
  digitalWrite(RED_LED_PIN,   red   ? HIGH : LOW);
  digitalWrite(GREEN_LED_PIN, green ? HIGH : LOW);
}

// ================================================================
// BATTERY — voltage divider (two equal resistors → Vmeasured = Vbatt/2)
// ================================================================
int readBatteryPercent() {
  const float VREF      = 3.3f;
  const float DIVIDER   = 2.0f;
  const float VBATT_MAX = 4.2f;
  const float VBATT_MIN = 3.3f;

  int   raw  = analogRead(BATTERY_ADC_PIN);
  float vPin = (raw / 4095.0f) * VREF;
  float vBat = vPin * DIVIDER;
  int   pct  = (int)(((vBat - VBATT_MIN) / (VBATT_MAX - VBATT_MIN)) * 100.0f);
  return constrain(pct, 0, 100);
}

// ================================================================
// GPS
// ================================================================
void gpsInit() {
  gpsSerial.begin(9600, SERIAL_8N1, GPS_RX_PIN, GPS_TX_PIN);
  Serial.println("[GPS] UART started");
}

void gpsFeed() {
  while (gpsSerial.available()) {
    gpsParser.encode(gpsSerial.read());
  }
}

GPSData getGPS() {
  GPSData g;
  g.valid      = gpsParser.location.isValid() && gpsParser.location.age() < 5000;
  g.lat        = g.valid ? gpsParser.location.lat() : 0.0;
  g.lng        = g.valid ? gpsParser.location.lng() : 0.0;
  g.accuracy   = gpsParser.hdop.isValid() ? gpsParser.hdop.value() * 5.0f : 99.9f;
  g.satellites = gpsParser.satellites.isValid() ? gpsParser.satellites.value() : 0;
  return g;
}

// ================================================================
// SIM800L AT HELPERS
// ================================================================
void gsmInit() {
  gsmSerial.begin(9600, SERIAL_8N1, GSM_RX_PIN, GSM_TX_PIN);
  delay(3000);
  Serial.println("[GSM] UART started");
}

bool atCmd(const char* cmd, const char* expect, uint32_t timeout = AT_TIMEOUT_MS) {
  gsmSerial.println(cmd);
  unsigned long start = millis();
  String resp = "";
  while (millis() - start < timeout) {
    while (gsmSerial.available()) resp += (char)gsmSerial.read();
    if (resp.indexOf(expect) != -1) return true;
    if (resp.indexOf("ERROR") != -1) break;
  }
  Serial.print("[GSM] "); Serial.print(cmd);
  Serial.print(" -> "); Serial.println(resp);
  return false;
}

bool gsmOpenBearer() {
  if (!atCmd("AT", "OK"))                               return false;
  if (!atCmd("AT+SAPBR=3,1,\"CONTYPE\",\"GPRS\"", "OK")) return false;
  if (!atCmd("AT+SAPBR=3,1,\"APN\",\"internet\"",  "OK")) return false; // ← change APN
  if (!atCmd("AT+SAPBR=1,1", "OK", 10000))              return false;
  if (!atCmd("AT+HTTPSSL=1", "OK"))                     return false;
  return true;
}

int httpPost(const char* path, const char* body) {
  int bodyLen = strlen(body);
  char cmd[256];

  if (!atCmd("AT+HTTPINIT", "OK")) return 0;

  if (!atCmd("AT+HTTPPARA=\"CID\",1", "OK")) {
    atCmd("AT+HTTPTERM", "OK");
    return 0;
  }

  snprintf(cmd, sizeof(cmd), "AT+HTTPPARA=\"URL\",\"https://%s%s\"", HOST, path);
  if (!atCmd(cmd, "OK")) {
    atCmd("AT+HTTPTERM", "OK");
    return 0;
  }

  if (!atCmd("AT+HTTPPARA=\"CONTENT\",\"application/json\"", "OK")) {
    atCmd("AT+HTTPTERM", "OK");
    return 0;
  }

  snprintf(cmd, sizeof(cmd), "AT+HTTPPARA=\"USERDATA\",\"x-device-secret: %s\"", DEVICE_SECRET);
  if (!atCmd(cmd, "OK")) {
    atCmd("AT+HTTPTERM", "OK");
    return 0;
  }

  snprintf(cmd, sizeof(cmd), "AT+HTTPDATA=%d,5000", bodyLen);
  if (!atCmd(cmd, "DOWNLOAD")) {
    atCmd("AT+HTTPTERM", "OK");
    return 0;
  }

  gsmSerial.print(body);
  delay(500);

  gsmSerial.println("AT+HTTPACTION=1");

  unsigned long start = millis();
  String resp = "";
  int statusCode = 0;

  while (millis() - start < 30000) {
    while (gsmSerial.available()) {
      resp += (char)gsmSerial.read();
    }

    int actionIdx = resp.indexOf("+HTTPACTION:");
    if (actionIdx != -1) {
      int firstComma = resp.indexOf(",", actionIdx);
      int secondComma = resp.indexOf(",", firstComma + 1);
      if (firstComma != -1 && secondComma != -1) {
        String codeStr = resp.substring(firstComma + 1, secondComma);
        statusCode = codeStr.toInt();
        break;
      }
    }
    if (resp.indexOf("ERROR") != -1) break;
  }

  Serial.print("[GSM HTTPS POST] -> Status Code Received: ");
  Serial.println(statusCode);

  atCmd("AT+HTTPTERM", "OK");
  return statusCode;
}

// ================================================================
// API CALLS
// ================================================================
const char* levelStr(SosLevel l) {
  return (l == SOS_HIGH) ? "HIGH" : "LOW";
}

bool sendSOS(GPSData& gps, SosLevel level) {
  if (!gps.valid) displayNoGPS();

  StaticJsonDocument<256> doc;
  doc["device_id"] = DEVICE_ID;
  doc["lat"]       = gps.lat;
  doc["lng"]       = gps.lng;
  doc["accuracy"]  = gps.accuracy;
  doc["battery"]   = readBatteryPercent();
  doc["level"]     = levelStr(level);
  char body[256];
  serializeJson(doc, body);

  for (int i = 0; i < HTTP_RETRIES; i++) {
    int code = httpPost("/api/public/ingest/sos", body);
    if (code == 200) { Serial.println("[SOS] OK"); return true; }
    if (code == 403) { Serial.println("[SOS] Device disabled"); return false; }
    Serial.printf("[SOS] Attempt %d failed, retrying...\n", i + 1);
    delay(2000 * (i + 1));
  }
  displayError();
  return false;
}

bool sendLocation(GPSData& gps) {
  StaticJsonDocument<200> doc;
  doc["device_id"] = DEVICE_ID;
  doc["lat"]       = gps.lat;
  doc["lng"]       = gps.lng;
  doc["accuracy"]  = gps.accuracy;
  doc["battery"]   = readBatteryPercent();
  char body[200];
  serializeJson(doc, body);

  for (int i = 0; i < HTTP_RETRIES; i++) {
    if (httpPost("/api/public/ingest/location", body) == 200) return true;
    delay(1000 * (i + 1));
  }
  return false;
}

bool sendCancel() {
  StaticJsonDocument<64> doc;
  doc["device_id"] = DEVICE_ID;
  char body[64];
  serializeJson(doc, body);

  for (int i = 0; i < HTTP_RETRIES; i++) {
    if (httpPost("/api/public/ingest/cancel", body) == 200) {
      Serial.println("[CANCEL] OK");
      return true;
    }
    delay(1000 * (i + 1));
  }
  return false;
}

// ================================================================
// BUTTON HANDLING — single button does everything
//   SOS inactive: single press = LOW, double press = HIGH
//   SOS active:   long press (2s) = cancel
// ================================================================
void checkSOSButton() {
  static unsigned long lastDebounce  = 0;
  static unsigned long pressStartAt  = 0;
  static bool          buttonHeld    = false;
  static bool          longPressFired = false;
  static bool          lastState     = HIGH;

  bool current = digitalRead(SOS_BUTTON_PIN);

  // ── Button just pressed ──────────────────────────────────────
  if (current == LOW && lastState == HIGH && millis() - lastDebounce > DEBOUNCE_MS) {
    lastDebounce   = millis();
    pressStartAt   = millis();
    buttonHeld     = true;
    longPressFired = false;

    // SOS inactive: detect first or second click for alert level
    if (!sosActive) {
      if (!waitingSecond) {
        waitingSecond = true;
        firstPressAt  = millis();
      } else {
        // Second press within window → HIGH
        waitingSecond = false;
        sosLevel = SOS_HIGH;
        GPSData g = getGPS();
        displaySending();
        if (sendSOS(g, sosLevel)) {
          sosActive = true;
          state     = STATE_SOS_ACTIVE;
          setLED(true, false);
          displayActive(sosLevel, readBatteryPercent());
        }
        buttonHeld = false; // handled
      }
    }
  }

  // ── Button held — show cancel progress while SOS is active ──
  if (current == LOW && buttonHeld && sosActive && !longPressFired) {
    uint32_t held = millis() - pressStartAt;
    if (held < LONG_PRESS_MS) {
      // Throttle OLED updates to ~10fps to prevent flicker
      static unsigned long lastOledUpdate = 0;
      if (millis() - lastOledUpdate > 100) {
        lastOledUpdate = millis();
        displayCancelling(held);
      }
    } else {
      // Long press threshold reached → cancel
      longPressFired = true;
      if (sendCancel()) {
        sosActive = false;
        state     = STATE_READY;
        setLED(false, true);
        displayCancel();
      }
    }
  }

  // ── Button released ──────────────────────────────────────────
  if (current == HIGH && lastState == LOW) {
    buttonHeld = false;
    // If user released before long press completed and SOS is still active,
    // restore the GPS status display
    if (sosActive && !longPressFired) {
      GPSData g = getGPS();
      displayGPSStatus(g);
    }
  }

  // ── Single-click window expired → LOW alert ─────────────────
  if (waitingSecond && millis() - firstPressAt > DOUBLE_CLICK_MS) {
    waitingSecond = false;
    sosLevel = SOS_LOW;
    GPSData g = getGPS();
    displaySending();
    if (sendSOS(g, sosLevel)) {
      sosActive = true;
      state     = STATE_SOS_ACTIVE;
      setLED(true, false);
      displayActive(sosLevel, readBatteryPercent());
    }
  }

  lastState = current;
}

// ================================================================
// LOCATION LOOP — 15s regardless of SOS state
// ================================================================
void locationLoop() {
  if (millis() - lastLocationAt < LOCATION_INTERVAL_MS) return;
  lastLocationAt = millis();
  GPSData g = getGPS();
  if (g.valid) {
    sendLocation(g);
    if (sosActive) displayGPSStatus(g);
  }
}

// ================================================================
// SETUP & LOOP
// ================================================================
void setup() {
  Serial.begin(115200);
  pinMode(SOS_BUTTON_PIN,    INPUT_PULLUP);
  pinMode(RED_LED_PIN,       OUTPUT);
  pinMode(GREEN_LED_PIN,     OUTPUT);

  Wire.begin();          // I2C for OLED (defaults: SDA=21, SCL=22)
  displayInit();
  gpsInit();
  gsmInit();
  gsmOpenBearer();

  state = STATE_READY;
  setLED(false, true);
  displayReady();
  Serial.println("[BOOT] Ready");
}

void loop() {
  gpsFeed();
  checkSOSButton();
  locationLoop();
}
