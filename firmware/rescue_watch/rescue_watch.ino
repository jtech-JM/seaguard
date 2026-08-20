#include <SoftwareSerial.h>
#include <TinyGPS++.h>

// --- PIN DEFINITIONS ---
const int BUTTON_PIN = D5; // Push button (INPUT_PULLUP)
const int LED_PIN    = D0; // Indicator LED

// --- SERIAL INTERFACES ---
SoftwareSerial sim800(D1, D2);    // SIM800L: ESP RX = D1 (SIM TX), ESP TX = D2 (SIM RX)
SoftwareSerial gpsSerial(D7, D6); // GPS NEO-6M: ESP RX = D7 (GPS TX), ESP TX = D6 (GPS RX)

TinyGPSPlus gps;

// --- BACKEND API CONFIGURATION ---
const String API_SERVER          = "seaguardb.vercel.app";
const String API_ENDPOINT_SOS      = "/api/public/ingest/sos";
const String API_ENDPOINT_LOCATION = "/api/public/ingest/location";
const String API_ENDPOINT_CANCEL   = "/api/public/ingest/cancel";
const String PROTOCOL            = "https";

// Device Credentials
const String DEVICE_ID     = "DEV-PZ2IFL";
const String DEVICE_SECRET = "3c8c4d69894125e3dc373f6a8e14c4c440cfad091bb93ef32cd965d5e91e7ffa";

// SIM Provider Configuration (Safaricom Kenya)
const String APN      = "safaricom";
const String APN_USER = "";
const String APN_PASS = "";

// --- SYSTEM STATES ---
enum SystemState { STATE_IDLE, STATE_ACQUIRING_GPS, STATE_SENDING_HTTP, STATE_SUCCESS, STATE_FAIL };
SystemState currentState = STATE_IDLE;

// --- TIMING & BUTTON VARIABLES ---
unsigned long buttonPressTime = 0;
bool isPressing = false;
bool longPressHandled = false;

unsigned long previousBlinkMillis = 0;
const long blinkInterval = 200; // Fast blink while processing
bool ledState = LOW;

// --- PERIODIC LOCATION TRACKING ---
unsigned long lastLocationSendTime = 0;
const long locationUpdateInterval = 30000; // Send location every 30 seconds
bool alertActive = false;

// --- FUNCTION DECLARATIONS ---
bool sendHTTP(String endpoint, String jsonPayload);
bool sendLocation(String lat, String lng, String accuracy);
bool sendCancel();
String sendATCommand(String cmd, unsigned long timeout, String expectedResponse);

void setup() {
  Serial.begin(115200);
  sim800.begin(9600);
  gpsSerial.begin(9600);

  pinMode(BUTTON_PIN, INPUT_PULLUP);
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);

  gpsSerial.listen();
  Serial.println("System Ready. Press button on D5 to trigger alert.");
}

void loop() {
  // Ensure GPS port is active during idle tracking
  if (currentState == STATE_IDLE || currentState == STATE_ACQUIRING_GPS) {
    if (!gpsSerial.isListening()) {
      gpsSerial.listen();
    }
    while (gpsSerial.available() > 0) {
      gps.encode(gpsSerial.read());
    }
  }

  int buttonState = digitalRead(BUTTON_PIN);
  unsigned long currentMillis = millis();

  // --- 1. BUTTON PRESS DETECTOR ---
  if (buttonState == LOW && !isPressing) {
    isPressing = true;
    buttonPressTime = currentMillis;
    longPressHandled = false;
  }

  // --- 2. LONG PRESS DETECTOR (CANCEL ACTION) ---
  if (isPressing && (currentMillis - buttonPressTime > 1500) && !longPressHandled) {
    longPressHandled = true;
    Serial.println("Long Press detected: Sending cancel request...");
    if (sendCancel()) {
      alertActive = false;
      currentState = STATE_IDLE;
      digitalWrite(LED_PIN, LOW);
      Serial.println("✓ ALERT CANCELLED via Long Press!");
    } else {
      Serial.println("✗ Failed to cancel alert.");
    }
  }

  // --- 3. SINGLE CLICK RELEASE ---
  if (buttonState == HIGH && isPressing) {
    isPressing = false;
    if (!longPressHandled) {
      Serial.println("Single Click: Triggering Emergency SOS Alert...");
      currentState = STATE_ACQUIRING_GPS;
    }
  }

  // --- 4. STATE MACHINE ---
  switch (currentState) {
    case STATE_IDLE:
      digitalWrite(LED_PIN, LOW);
      break;

    case STATE_ACQUIRING_GPS: {
      // Non-blocking LED Blinking while working
      if (currentMillis - previousBlinkMillis >= blinkInterval) {
        previousBlinkMillis = currentMillis;
        ledState = !ledState;
        digitalWrite(LED_PIN, ledState);
      }

      String jsonPayload;
      if (gps.location.isValid()) {
        float latitude = gps.location.lat();
        float longitude = gps.location.lng();

        jsonPayload = "{\"device_id\":\"" + DEVICE_ID + "\","
                    + "\"device_secret\":\"" + DEVICE_SECRET + "\","
                    + "\"lat\":" + String(latitude, 6) + ","
                    + "\"lng\":" + String(longitude, 6) + ","
                    + "\"accuracy\":" + String(gps.hdop.hdop(), 1) + ","
                    + "\"level\":\"HIGH\"}";
      } else {
        Serial.println("GPS Fix pending... Sending alert without location.");
        jsonPayload = "{\"device_id\":\"" + DEVICE_ID + "\","
                    + "\"device_secret\":\"" + DEVICE_SECRET + "\","
                    + "\"lat\":0.0,"
                    + "\"lng\":0.0,"
                    + "\"level\":\"HIGH\"}";
      }

      currentState = STATE_SENDING_HTTP;
      if (sendHTTP(API_ENDPOINT_SOS, jsonPayload)) {
        currentState = STATE_SUCCESS;
      } else {
        currentState = STATE_FAIL;
      }
      break;
    }

    case STATE_SENDING_HTTP:
      break;

    case STATE_SUCCESS:
      digitalWrite(LED_PIN, HIGH);
      if (!alertActive) {
        // First time entering SUCCESS: arm the timer and mark alert active
        alertActive = true;
        lastLocationSendTime = currentMillis;
      }

      if (alertActive && (currentMillis - lastLocationSendTime >= locationUpdateInterval)) {
        lastLocationSendTime = currentMillis;
        if (gps.location.isValid()) {
          float latitude = gps.location.lat();
          float longitude = gps.location.lng();
          Serial.println("[LOCATION] Sending periodic GPS update...");
          sendLocation(String(latitude, 6), String(longitude, 6), String(gps.hdop.hdop(), 1));
        }
      }
      break;

    case STATE_FAIL:
      digitalWrite(LED_PIN, LOW);
      Serial.println("Failed to transmit SOS alert.");
      alertActive = false;
      currentState = STATE_IDLE;
      break;
  }
}

// --- HELPER ROUTINE FOR ROBUST AT COMMAND HANDLING ---
String sendATCommand(String cmd, unsigned long timeout, String expectedResponse) {
  String response = "";
  
  // Flush rx buffer before sending new command
  while(sim800.available()) sim800.read();

  sim800.println(cmd);
  unsigned long startTime = millis();

  while (millis() - startTime < timeout) {
    while (sim800.available() > 0) {
      char c = sim800.read();
      response += c;
    }
    if (expectedResponse != "" && response.indexOf(expectedResponse) != -1) {
      break;
    }
  }
  return response;
}

// --- SIM800L HTTPS POST ROUTINE ---
bool sendHTTP(String endpoint, String jsonPayload) {
  sim800.listen();
  delay(200);

  // Full reset sequence for pending modem states
  sendATCommand("ATE0", 1000, "OK");
  sendATCommand("AT+HTTPTERM", 2000, "");
  sendATCommand("AT+SAPBR=0,1", 2000, "");

  // Network registration check
  String reg = sendATCommand("AT+CREG?", 2000, "OK");
  if (reg.indexOf("+CREG: 0,1") == -1 && reg.indexOf("+CREG: 0,5") == -1) {
    Serial.println("[HTTP] Error: Network registration check failed.");
    gpsSerial.listen();
    return false;
  }

  // Configure GPRS and Bearer Parameters
  Serial.println("[HTTP] Enabling GPRS...");
  sendATCommand("AT+CGATT=1", 3000, "OK");
  sendATCommand("AT+SAPBR=3,1,\"Contype\",\"GPRS\"", 1000, "OK");
  sendATCommand("AT+SAPBR=3,1,\"APN\",\"" + APN + "\"", 1000, "OK");

  if (APN_USER.length() > 0) {
    sendATCommand("AT+SAPBR=3,1,\"USER\",\"" + APN_USER + "\"", 1000, "OK");
  }
  if (APN_PASS.length() > 0) {
    sendATCommand("AT+SAPBR=3,1,\"PWD\",\"" + APN_PASS + "\"", 1000, "OK");
  }

  // Open GPRS Bearer profile
  Serial.println("[HTTP] Opening GPRS bearer...");
  String sapResp = sendATCommand("AT+SAPBR=1,1", 10000, "OK");
  if (sapResp.indexOf("OK") == -1 && sapResp.indexOf("ALREADY CONNECTED") == -1) {
    Serial.println("[HTTP] Error: Failed to open GPRS bearer.");
    gpsSerial.listen();
    return false;
  }

  // Initialize HTTP Service
  Serial.println("[HTTP] Initializing HTTP...");
  String httpInitResp = sendATCommand("AT+HTTPINIT", 3000, "OK");
  if (httpInitResp.indexOf("OK") == -1) {
    Serial.println("[HTTP] Error: HTTP Init failed.");
    sendATCommand("AT+SAPBR=0,1", 2000, "OK");
    gpsSerial.listen();
    return false;
  }

  sendATCommand("AT+HTTPPARA=\"CID\",1", 1000, "OK");
  sendATCommand("AT+HTTPSSL=1", 1000, "OK");

  // Configure URL and Request Headers
  String fullUrl = PROTOCOL + "://" + API_SERVER + endpoint;
  sendATCommand("AT+HTTPPARA=\"URL\",\"" + fullUrl + "\"", 1000, "OK");
  sendATCommand("AT+HTTPPARA=\"CONTENT\",\"application/json\"", 1000, "OK");

  // Load payload data
  int payloadLen = jsonPayload.length();
  Serial.println("[HTTP] Payload: " + jsonPayload);
  Serial.println("[HTTP] Payload Length: " + String(payloadLen));

  String dataResp = sendATCommand("AT+HTTPDATA=" + String(payloadLen) + ",10000", 3000, "DOWNLOAD");
  if (dataResp.indexOf("DOWNLOAD") == -1) {
    Serial.println("[HTTP] Failed entering DOWNLOAD mode.");
    sendATCommand("AT+HTTPTERM", 2000, "OK");
    sendATCommand("AT+SAPBR=0,1", 2000, "OK");
    gpsSerial.listen();
    return false;
  }

  sim800.print(jsonPayload);
  delay(1000); // Give buffer time to lock in payload data

  // Execute POST Request
  Serial.println("[HTTP] Sending POST request...");
  sim800.println("AT+HTTPACTION=1");

  String actionResp = "";
  unsigned long startAction = millis();
  while (millis() - startAction < 25000) {
    while (sim800.available() > 0) {
      char c = sim800.read();
      actionResp += c;
    }
    if (actionResp.indexOf("+HTTPACTION:") != -1) {
      break;
    }
  }

  Serial.println("[HTTP] Response: " + actionResp);

  bool success = false;
  if (actionResp.indexOf(",200,") != -1 || actionResp.indexOf(",201,") != -1) {
    Serial.println("✓ SOS Alert sent successfully!");
    sendATCommand("AT+HTTPREAD", 3000, "OK");
    success = true;
  } else {
    Serial.println("✗ Failed to send SOS Alert");
  }

  // Cleanup session
  sendATCommand("AT+HTTPTERM", 2000, "OK");
  sendATCommand("AT+SAPBR=0,1", 2000, "OK");

  gpsSerial.listen();
  return success;
}

// --- SIM800L PERIODIC LOCATION UPDATE ---
bool sendLocation(String lat, String lng, String accuracy) {
  String jsonPayload = "{\"device_id\":\"" + DEVICE_ID + "\","
                     + "\"device_secret\":\"" + DEVICE_SECRET + "\","
                     + "\"lat\":" + lat + ","
                     + "\"lng\":" + lng + ","
                     + "\"accuracy\":" + accuracy + "}";
  return sendHTTP(API_ENDPOINT_LOCATION, jsonPayload);
}

// --- SIM800L CANCEL ALERT ---
bool sendCancel() {
  String nonce = "cancel_" + String(millis());
  String jsonPayload = "{\"device_id\":\"" + DEVICE_ID + "\","
                     + "\"device_secret\":\"" + DEVICE_SECRET + "\","
                     + "\"nonce\":\"" + nonce + "\"}";
  return sendHTTP(API_ENDPOINT_CANCEL, jsonPayload);
}
