// Continuous GPS updates from a hardware device.
// Auth: header `x-device-secret: <secret>`.
// Body: { device_id, lat, lng, accuracy?, battery?, level?, event_id?, timestamp? }
//
// Request handling lives in `@/lib/ingest-core`.
import { createFileRoute } from "@tanstack/react-router";
import { corsPreflight, handleLocation } from "@/lib/ingest-core";
import { createIngestDeps } from "@/lib/ingest-deps.server";
import { hashDeviceSecret } from "@/lib/hardware-ingest";

export const Route = createFileRoute("/api/public/ingest/location")({
  server: {
    handlers: {
      OPTIONS: async () => corsPreflight(),
      POST: async ({ request }) =>
        handleLocation(await createIngestDeps(), request, hashDeviceSecret),
    },
  },
});
