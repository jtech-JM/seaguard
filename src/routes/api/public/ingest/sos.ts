// Public ingest endpoint for hardware SOS triggers.
// Auth: header `x-device-secret: <secret>` — issued per device in the BMU console.
// Body: { device_id, lat?, lng?, accuracy?, battery?, level?, gps_fix?, event_id?, timestamp? }
//
// All request handling lives in `@/lib/ingest-core`; this file only wires the
// route to the Supabase-backed store. See HARDWARE_INTEGRATION.md for the
// status-code contract the firmware relies on.
import { createFileRoute } from "@tanstack/react-router";
import { corsPreflight, handleSos } from "@/lib/ingest-core";
import { createIngestDeps } from "@/lib/ingest-deps.server";
import { hashDeviceSecret } from "@/lib/hardware-ingest";

export const Route = createFileRoute("/api/public/ingest/sos")({
  server: {
    handlers: {
      OPTIONS: async () => corsPreflight(),
      POST: async ({ request }) => handleSos(await createIngestDeps(), request, hashDeviceSecret),
    },
  },
});
