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
