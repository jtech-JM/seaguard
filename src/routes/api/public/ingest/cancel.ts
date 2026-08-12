// Cancels any open SOS for a device (hardware "safe"/cancel action).
// Auth: header `x-device-secret: <secret>`.
// Body: { device_id, reason?, event_id?, timestamp? }
//
// Request handling lives in `@/lib/ingest-core`.
import { createFileRoute } from "@tanstack/react-router";
import { corsPreflight, handleCancel } from "@/lib/ingest-core";
import { createIngestDeps } from "@/lib/ingest-deps.server";
import { hashDeviceSecret } from "@/lib/hardware-ingest";

export const Route = createFileRoute("/api/public/ingest/cancel")({
  server: {
    handlers: {
      OPTIONS: async () => corsPreflight(),
      POST: async ({ request }) =>
        handleCancel(await createIngestDeps(), request, hashDeviceSecret),
    },
  },
});
