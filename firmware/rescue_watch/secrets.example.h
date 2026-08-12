// ------------------------------------------------------------
// SEAGUARD device credentials — TEMPLATE
//
// Copy this file to `secrets.h` in the same directory and fill in the values
// from the BMU console. `secrets.h` is git-ignored: device credentials must
// never be committed. A secret that reaches version control is compromised and
// has to be rotated from the BMU console before the device is deployed.
//
//   cp secrets.example.h secrets.h
// ------------------------------------------------------------
#pragma once

// Device label printed on the hardware, e.g. "DEV-ABC123".
#define SEAGUARD_DEVICE_ID "DEV-XXXXXX"

// Shown once when the device is registered, and again only after a rotation.
#define SEAGUARD_DEVICE_SECRET "paste_the_device_secret_here"

// Deployment host, without scheme and without a trailing slash.
#define SEAGUARD_HOST "your-domain.com"

// Cellular APN for the fitted SIM. Leave user/pass empty when the carrier does
// not require them — Safaricom Kenya does not.
#define SEAGUARD_APN "safaricom"
#define SEAGUARD_APN_USER ""
#define SEAGUARD_APN_PASS ""

// ------------------------------------------------------------
// TLS trust anchor — required for production
//
// Without this the modem encrypts the session but accepts ANY certificate,
// so anyone able to intercept the GPRS path can read the device secret out of
// the request header and forge a /cancel against a live distress alert.
//
// Paste the PEM of the root CA that issued your deployment's certificate. Get
// it from the server rather than guessing — an anchor that does not match the
// chain takes the device off the air:
//
//   openssl s_client -showcerts -connect your-domain.com:443 </dev/null \
//     | awk '/BEGIN CERT/{c++} c' | openssl x509 -outform pem
//
// Keep the embedded newlines exactly as below. Leave the whole define commented
// out only for bench testing; the firmware then prints a warning on every boot.
//
// #define SEAGUARD_CA_CERT \
//   "-----BEGIN CERTIFICATE-----\n" \
//   "MIIFazCCA1OgAwIBAgIRAIIQz7DSQONZRGPgu2OCiwAwDQYJKoZIhvcNAQELBQAw\n" \
//   "...remaining base64 lines...\n" \
//   "-----END CERTIFICATE-----\n"

// Optional. Where the certificate is stored in the modem's filesystem; the
// default suits stock SIM800L firmware and rarely needs changing.
// #define SEAGUARD_CA_CERT_PATH "C:\\USER\\seaguard-ca.crt"
