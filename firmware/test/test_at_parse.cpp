// Host-side unit tests for firmware/rescue_watch/at_parse.h.
//
// These compile and run the real firmware parsing code on the build machine —
// no Arduino toolchain and no hardware required. Run with:
//   node scripts/run-firmware-tests.mjs
//
// They do NOT prove anything about SIM800L radio behaviour, TLS negotiation or
// GPS acquisition; those still need a physical device (see the hardware
// verification section of HARDWARE_INTEGRATION.md).
#include "../rescue_watch/at_parse.h"

#include <cstdio>
#include <cstring>

static int failures = 0;
static int checks = 0;

static void expectInt(const char* name, int actual, int expected) {
  checks++;
  if (actual != expected) {
    failures++;
    std::printf("not ok - %s (expected %d, got %d)\n", name, expected, actual);
  } else {
    std::printf("ok - %s\n", name);
  }
}

static void expectBool(const char* name, bool actual, bool expected) {
  checks++;
  if (actual != expected) {
    failures++;
    std::printf("not ok - %s (expected %s, got %s)\n", name, expected ? "true" : "false",
                actual ? "true" : "false");
  } else {
    std::printf("ok - %s\n", name);
  }
}

int main() {
  using namespace seaguard;

  // ---- +HTTPACTION -------------------------------------------------------
  // The exact byte sequence a SIM800L returns after a successful POST. The
  // previous firmware searched for "+HTTPACTION:1,200" and therefore treated
  // this — a delivered SOS — as a failure.
  expectInt("documented SIM800L success URC (space after colon)",
            parseHttpActionStatus("\r\nOK\r\n\r\n+HTTPACTION: 1,200,52\r\n"), 200);
  expectInt("no space after colon", parseHttpActionStatus("+HTTPACTION:1,200,52"), 200);
  expectInt("extra padding around separators",
            parseHttpActionStatus("+HTTPACTION:  1 , 200 , 52"), 200);
  expectInt("201 Created", parseHttpActionStatus("+HTTPACTION: 1,201,0"), 201);
  expectInt("401 unauthorised is reported, not swallowed",
            parseHttpActionStatus("+HTTPACTION: 1,401,44"), 401);
  expectInt("403 disabled device", parseHttpActionStatus("+HTTPACTION: 1,403,30"), 403);
  expectInt("503 retryable", parseHttpActionStatus("+HTTPACTION: 1,503,0"), 503);
  expectInt("modem's own 6xx network error code",
            parseHttpActionStatus("+HTTPACTION: 1,601,0"), 601);
  expectInt("URC preceded by unrelated chatter",
            parseHttpActionStatus("RDY\r\n+CFUN: 1\r\n+HTTPACTION: 1,200,7\r\n"), 200);
  expectInt("no URC at all", parseHttpActionStatus("\r\nOK\r\n"), -1);
  expectInt("truncated URC", parseHttpActionStatus("+HTTPACTION: 1,"), -1);
  expectInt("empty response", parseHttpActionStatus(""), -1);
  expectInt("null response", parseHttpActionStatus(NULL), -1);

  // ---- +SAPBR ------------------------------------------------------------
  expectBool("bearer connected", parseBearerConnected("+SAPBR: 1,1,\"10.181.4.7\"\r\nOK\r\n"), true);
  expectBool("bearer connecting", parseBearerConnected("+SAPBR: 1,2,\"0.0.0.0\"\r\nOK\r\n"), false);
  expectBool("bearer closed", parseBearerConnected("+SAPBR: 1,3,\"0.0.0.0\"\r\nOK\r\n"), false);
  expectBool("bearer no space", parseBearerConnected("+SAPBR:1,1,\"10.0.0.1\""), true);
  expectBool("no bearer URC", parseBearerConnected("OK"), false);

  // ---- +CREG -------------------------------------------------------------
  expectBool("registered on home network", parseRegistered("+CREG: 0,1\r\nOK\r\n"), true);
  // The old firmware matched only "0,1" and stranded roaming devices.
  expectBool("registered while roaming", parseRegistered("+CREG: 0,5\r\nOK\r\n"), true);
  expectBool("searching for a network", parseRegistered("+CREG: 0,2\r\nOK\r\n"), false);
  expectBool("registration denied", parseRegistered("+CREG: 0,3\r\nOK\r\n"), false);
  expectBool("not registered", parseRegistered("+CREG: 0,0\r\nOK\r\n"), false);
  expectBool("unsolicited mode 2, roaming", parseRegistered("+CREG: 2,5,\"1A2B\",\"3C4D\""), true);
  expectBool("no CREG URC", parseRegistered("OK"), false);

  // ---- +SSLSETCERT -------------------------------------------------------
  // 0 is the only outcome that means the trust anchor was installed. Everything
  // else, including a missing URC, has to be treated as a failure — the device
  // refuses to transmit rather than fall back to an unauthenticated session.
  expectInt("CA accepted", parseSslSetCertResult("\r\nOK\r\n\r\n+SSLSETCERT: 0\r\n"), 0);
  expectInt("CA accepted, no space", parseSslSetCertResult("+SSLSETCERT:0"), 0);
  expectInt("CA rejected", parseSslSetCertResult("\r\n+SSLSETCERT: 1\r\n"), 1);
  expectInt("CA error code 4", parseSslSetCertResult("+SSLSETCERT: 4"), 4);
  // Bare OK: the command was understood but the modem never reported an
  // outcome, so the install is unconfirmed and must not count as success.
  expectInt("no result URC", parseSslSetCertResult("\r\nOK\r\n"), -1);
  expectInt("modem error", parseSslSetCertResult("\r\nERROR\r\n"), -1);
  expectInt("truncated URC", parseSslSetCertResult("+SSLSETCERT:"), -1);
  expectInt("null response", parseSslSetCertResult(NULL), -1);

  // ---- FSWRITE prompt ----------------------------------------------------
  expectBool("write prompt", parseWritePrompt("\r\n> "), true);
  expectBool("prompt after echo", parseWritePrompt("AT+FSWRITE=...\r\n>"), true);
  expectBool("no prompt yet", parseWritePrompt("\r\n"), false);
  // A modem that rejects the path answers ERROR; the '>' check must not race
  // ahead of that and start streaming certificate bytes as AT commands.
  expectBool("error not a prompt", parseWritePrompt("\r\nERROR\r\n"), false);
  expectBool("error wins over prompt", parseWritePrompt("> \r\nERROR\r\n"), false);
  expectBool("null response is not a prompt", parseWritePrompt(NULL), false);

  // ---- retry policy ------------------------------------------------------
  expectBool("200 accepted", isAccepted(200), true);
  expectBool("204 accepted", isAccepted(204), true);
  expectBool("401 not accepted", isAccepted(401), false);
  expectBool("transport failure not accepted", isAccepted(-1), false);
  expectBool("400 is permanent", isPermanentRejection(400), true);
  expectBool("401 is permanent", isPermanentRejection(401), true);
  expectBool("403 is permanent", isPermanentRejection(403), true);
  // 429 and 5xx must keep retrying — this is what stops a transient outage from
  // permanently discarding a distress call.
  expectBool("429 is retryable", isPermanentRejection(429), false);
  expectBool("500 is retryable", isPermanentRejection(500), false);
  expectBool("503 is retryable", isPermanentRejection(503), false);
  expectBool("transport failure is retryable", isPermanentRejection(-1), false);

  std::printf("\n1..%d\n", checks);
  if (failures > 0) {
    std::printf("# %d of %d checks FAILED\n", failures, checks);
    return 1;
  }
  std::printf("# all %d checks passed\n", checks);
  return 0;
}
