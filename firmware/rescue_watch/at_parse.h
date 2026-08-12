// ------------------------------------------------------------
// SIM800L AT response parsing.
//
// Deliberately free of Arduino types so it can be compiled and unit-tested on a
// host machine — see firmware/test/test_at_parse.cpp. Mis-parsing the
// +HTTPACTION URC is what made every successful SOS look like a failure, so the
// parser has tests even though the rest of the firmware cannot be run off-board.
// ------------------------------------------------------------
#pragma once

#include <ctype.h>
#include <stddef.h>
#include <string.h>

namespace seaguard {

// Extracts the HTTP status from an +HTTPACTION unsolicited result code.
//
// The SIM800L documents the URC as "+HTTPACTION: <method>,<status>,<datalen>"
// and emits it with a space after the colon, often preceded by "OK" and CRLF
// from the command that triggered it, e.g.
//
//     "\r\nOK\r\n\r\n+HTTPACTION: 1,200,52\r\n"
//
// Firmware in the field also emits it without the space, and some builds pad
// with extra spaces around the commas, so every separator is skipped tolerantly
// instead of pattern-matching one exact string.
//
// Returns the status code, or -1 when the response contains no usable URC.
inline int parseHttpActionStatus(const char* response) {
  if (response == NULL) return -1;
  const char* at = strstr(response, "+HTTPACTION:");
  if (at == NULL) return -1;

  const char* p = at + 12;  // past "+HTTPACTION:"

  while (*p != '\0' && isspace((unsigned char)*p)) p++;
  // Method field ("1" for POST). Absent on malformed output, which is fine.
  while (*p != '\0' && isdigit((unsigned char)*p)) p++;
  while (*p != '\0' && (isspace((unsigned char)*p) || *p == ',')) p++;

  int status = 0;
  int digits = 0;
  while (*p != '\0' && isdigit((unsigned char)*p)) {
    status = status * 10 + (*p - '0');
    p++;
    digits++;
  }
  if (digits == 0) return -1;
  return status;
}

// The +SAPBR query reports the GPRS bearer state as
// "+SAPBR: <cid>,<status>,<ip>" where status 1 means connected.
inline bool parseBearerConnected(const char* response) {
  if (response == NULL) return false;
  const char* at = strstr(response, "+SAPBR:");
  if (at == NULL) return false;

  const char* p = at + 7;
  while (*p != '\0' && isspace((unsigned char)*p)) p++;
  while (*p != '\0' && isdigit((unsigned char)*p)) p++;  // cid
  while (*p != '\0' && (isspace((unsigned char)*p) || *p == ',')) p++;

  return *p == '1' && !isdigit((unsigned char)*(p + 1));
}

// Network registration: "+CREG: <n>,<stat>". 1 = registered on the home
// network, 5 = registered while roaming. A roaming SIM is perfectly usable, and
// rejecting it stranded devices that had attached to a partner network.
inline bool parseRegistered(const char* response) {
  if (response == NULL) return false;
  const char* at = strstr(response, "+CREG:");
  if (at == NULL) return false;

  const char* p = at + 6;
  while (*p != '\0' && isspace((unsigned char)*p)) p++;
  while (*p != '\0' && isdigit((unsigned char)*p)) p++;  // <n>
  while (*p != '\0' && (isspace((unsigned char)*p) || *p == ',')) p++;

  return *p == '1' || *p == '5';
}

// True when the modem reported a status that will not improve on retry:
// the request reached the server and was refused on its merits.
inline bool isPermanentRejection(int status) {
  return status >= 400 && status < 500 && status != 429;
}

inline bool isAccepted(int status) { return status >= 200 && status < 300; }

}  // namespace seaguard
