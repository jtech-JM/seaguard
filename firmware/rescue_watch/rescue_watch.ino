#include <SoftwareSerial.h>
#include <TinyGPS++.h>

// ------------------------------------------------------------
// SEAGUARD hardware firmware
// ESP8266/ESP32 + GPS + SIM800L -> SEAGUARD ingest API
// ------------------------------------------------------------

// ----- PIN DEFINITIONS -----
#if defined(ESP8266)
const int BUTTON_PIN = D5;  // GPIO14, safe push-button input
const int LED_PIN = D0;     // GPIO16, external LED output
const int SIM800_RX_PIN = D2; // GPIO4
const int SIM800_TX_PIN = D1; // GPIO5
const int GPS_RX_PIN = D6;    // GPIO12
const int GPS_TX_PIN = D7;    // GPIO13
#else
const int BUTTON_PIN = D5;
const int LED_PIN = D0;
const int SIM800_RX_PIN = D2;
const int SIM800_TX_PIN = D1;
const int GPS_RX_PIN = D6;
const int GPS_TX_PIN = D7;
#endif

// ----- SERIAL INTERFACES -----
SoftwareSerial sim800(SIM800_RX_PIN, SIM800_TX_PIN);
SoftwareSerial gpsSerial(GPS_RX_PIN, GPS_TX_PIN);
TinyGPSPlus gps;

// ----- CONFIGURATION -----
const char* DEVICE_ID = "DEV-9WK7LO";
const char* DEVICE_SECRET = "11350149f595454f018bd0a68b6faab011444921a2c79e15";
const char* HOST = "seaguardb.vercel.app";
const char* APN = "safaricom";
const char* APN_USER = "safaricom";
const char* APN_PASS = "safaricom";
const char* PATH_SOS = "/api/public/ingest/sos";
const char* PATH_LOCATION = "/api/public/ingest/location";
const char* PATH_CANCEL = "/api/public/ingest/cancel";

// ----- SYSTEM STATE -----
enum SystemState {
  STATE_IDLE,
  STATE_ACQUIRING_GPS,
  STATE_SENDING,
  STATE_SUCCESS,
  STATE_FAIL
};
SystemState currentState = STATE_IDLE;

// ----- BUTTON STATE -----
unsigned long buttonPressTime = 0;
bool isPressing = false;
bool longPressHandled = false;

unsigned long previousBlinkMillis = 0;
const long blinkInterval = 200;
bool ledState = LOW;

unsigned long lastLocationSend = 0;
const unsigned long LOCATION_INTERVAL_MS = 15000;

// ----- FUNCTION DECLARATIONS -----
void feedGps();
String readSimResponse(unsigned long timeoutMs);
bool sendAt(const String& command, const String& expected = "OK", unsigned long timeoutMs = 5000);
bool initGsm();
bool postJson(const char* path, const String& payload);
bool trySendSos();
bool trySendLocation();
bool trySendCancel();

void setup() {
  Serial.begin(115200);
  sim800.begin(9600);
  gpsSerial.begin(9600);

  pinMode(BUTTON_PIN, INPUT_PULLUP);
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);

  Serial.println("SEAGUARD hardware init");
  initGsm();
  Serial.println("Press button to trigger SOS");
}

void loop() {
  feedGps();

  int buttonState = digitalRead(BUTTON_PIN);
  unsigned long currentMillis = millis();

  if (buttonState == LOW && !isPressing) {
    isPressing = true;
    buttonPressTime = currentMillis;
    longPressHandled = false;
  }

  if (isPressing && (currentMillis - buttonPressTime > 1500) && !longPressHandled) {
    longPressHandled = true;
    currentState = STATE_IDLE;
    digitalWrite(LED_PIN, LOW);
    Serial.println("Cancel requested");
    trySendCancel();
  }

  if (buttonState == HIGH && isPressing) {
    isPressing = false;
    if (!longPressHandled) {
      Serial.println("Single click: trigger SOS");
      currentState = STATE_ACQUIRING_GPS;
    }
  }

  switch (currentState) {
    case STATE_IDLE:
      digitalWrite(LED_PIN, LOW);
      if (currentMillis - lastLocationSend >= LOCATION_INTERVAL_MS) {
        trySendLocation();
        lastLocationSend = currentMillis;
      }
      break;

    case STATE_ACQUIRING_GPS:
    case STATE_SENDING:
      if (currentMillis - previousBlinkMillis >= blinkInterval) {
        previousBlinkMillis = currentMillis;
        ledState = !ledState;
        digitalWrite(LED_PIN, ledState);
      }

      currentState = STATE_SENDING;
      trySendSos();
      break;

    case STATE_SUCCESS:
      digitalWrite(LED_PIN, HIGH);
      delay(3000);
      currentState = STATE_IDLE;
      break;

    case STATE_FAIL:
      digitalWrite(LED_PIN, LOW);
      Serial.println("SOS failed");
      currentState = STATE_IDLE;
      break;
  }
}

void feedGps() {
  gpsSerial.listen();
  while (gpsSerial.available() > 0) {
    gps.encode(gpsSerial.read());
  }
}

String readSimResponse(unsigned long timeoutMs) {
  String response;
  unsigned long start = millis();
  while (millis() - start < timeoutMs) {
    while (sim800.available()) {
      char c = sim800.read();
      response += c;
      start = millis();
    }
  }
  return response;
}

bool sendAt(const String& command, const String& expected, unsigned long timeoutMs) {
  sim800.listen();
  sim800.println(command);
  String response = readSimResponse(timeoutMs);
  Serial.println(response);
  return response.indexOf(expected) != -1;
}

bool initGsm() {
  if (!sendAt("AT", "OK")) return false;
  if (!sendAt("ATE0", "OK")) return false;
  if (!sendAt("AT+CPIN?", "READY")) return false;
  if (!sendAt("AT+CREG?", "0,1")) return false;

  if (!sendAt(String("AT+SAPBR=3,1,\"Contype\",\"GPRS\""), "OK")) return false;
  if (!sendAt(String("AT+SAPBR=3,1,\"APN\",\"") + APN + String("\""), "OK")) return false;
  if (strlen(APN_USER) > 0) {
    if (!sendAt(String("AT+SAPBR=3,1,\"USER\",\"") + APN_USER + String("\""), "OK")) return false;
  }
  if (strlen(APN_PASS) > 0) {
    if (!sendAt(String("AT+SAPBR=3,1,\"PWD\",\"") + APN_PASS + String("\""), "OK")) return false;
  }
  if (!sendAt("AT+SAPBR=1,1", "OK")) return false;
  return true;
}

bool trySendSos() {
  String payload = "{\"device_id\":\"";
  payload += DEVICE_ID;
  payload += "\",\"lat\":";
  payload += gps.location.isValid() ? String(gps.location.lat(), 6) : "0.000000";
  payload += ",\"lng\":";
  payload += gps.location.isValid() ? String(gps.location.lng(), 6) : "0.000000";
  payload += ",\"accuracy\":";
  payload += gps.location.isValid() ? String(gps.hdop.hdop(), 1) : "999.0";
  payload += ",\"battery\":80,\"level\":\"LOW\"}";

  if (postJson(PATH_SOS, payload)) {
    currentState = STATE_SUCCESS;
    lastLocationSend = millis();
    return true;
  }

  currentState = STATE_FAIL;
  return false;
}

bool trySendLocation() {
  String payload = "{\"device_id\":\"";
  payload += DEVICE_ID;
  payload += "\",\"lat\":";
  payload += gps.location.isValid() ? String(gps.location.lat(), 6) : "0.000000";
  payload += ",\"lng\":";
  payload += gps.location.isValid() ? String(gps.location.lng(), 6) : "0.000000";
  payload += ",\"accuracy\":";
  payload += gps.location.isValid() ? String(gps.hdop.hdop(), 1) : "999.0";
  payload += ",\"battery\":80}";

  return postJson(PATH_LOCATION, payload);
}

bool trySendCancel() {
  String payload = "{\"device_id\":\"";
  payload += DEVICE_ID;
  payload += "\"}";
  return postJson(PATH_CANCEL, payload);
}

bool postJson(const char* path, const String& payload) {
  String url = "https://";
  url += HOST;
  url += path;

  sim800.listen();
  if (!sendAt("AT+HTTPINIT", "OK")) return false;
  if (!sendAt("AT+HTTPSSL=1", "OK")) return false;
  if (!sendAt("AT+HTTPPARA=\"CID\",1", "OK")) return false;
  if (!sendAt(String("AT+HTTPPARA=\"URL\",\"") + url + String("\""), "OK")) return false;
  if (!sendAt("AT+HTTPPARA=\"REDIR\",1", "OK")) return false;
  if (!sendAt("AT+HTTPPARA=\"CONTENT\",\"application/json\"", "OK")) return false;
  if (!sendAt(String("AT+HTTPPARA=\"USERDATA\",\"x-device-secret:") + DEVICE_SECRET + String("\""), "OK")) return false;

  sim800.print("AT+HTTPDATA=");
  sim800.print(payload.length());
  sim800.println(",5000");
  String response = readSimResponse(5000);
  Serial.println(response);
  if (response.indexOf("DOWNLOAD") == -1) return false;

  sim800.print(payload);
  sim800.write(0x1A);
  response = readSimResponse(5000);
  Serial.println(response);
  if (response.indexOf("OK") == -1) return false;

  sim800.println("AT+HTTPACTION=1");
  response = readSimResponse(10000);
  Serial.println(response);
  if (response.indexOf("+HTTPACTION:1,200") != -1 || response.indexOf("+HTTPACTION:1,201") != -1) {
    return true;
  }
  return false;
}
