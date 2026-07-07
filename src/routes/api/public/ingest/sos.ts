// Public ingest endpoint for hardware SOS triggers.
// Auth: header `x-device-secret: <secret>` — issued per device in the BMU console.
// Body: { device_id: string, lat: number, lng: number, accuracy?: number }
// Creates a new active alert for the device (reuses any open alert) and logs the GPS fix.
// This endpoint is the stable contract for ESP32 + GPS + SIM7600 hardware.
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const Body = z.object({
  device_id: z.string().min(1),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy: z.number().nonnegative().optional(),
  battery: z.number().min(0).max(100).optional(),
  level: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
});

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, x-device-secret",
};

function timingSafeEq(a: string, b: string) {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

export const Route = createFileRoute("/api/public/ingest/sos")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: cors }),
      POST: async ({ request }) => {
        try {
          const secret = request.headers.get("x-device-secret") ?? "";
          if (!secret) {
            return Response.json({ error: "Missing x-device-secret" }, { status: 401, headers: cors });
          }
          const body = Body.parse(await request.json());
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          const { data: device, error: dErr } = await supabaseAdmin
            .from("devices")
            .select("id, boat_id, active, device_secret, boats:boat_id(id, owner_fisherman_id, bmu_id)")
            .eq("device_id", body.device_id)
            .maybeSingle();
          if (dErr) throw dErr;
          if (!device || !timingSafeEq(secret, (device as any).device_secret ?? "")) {
            return Response.json({ error: "Invalid device credentials" }, { status: 401, headers: cors });
          }
          if (!(device as any).active) {
            return Response.json({ error: "Device disabled" }, { status: 403, headers: cors });
          }

          const { data: existing } = await supabaseAdmin
            .from("sos_alerts")
            .select("id")
            .eq("device_id", device.id)
            .in("status", ["new", "acknowledged", "assigned", "in_progress"])
            .maybeSingle();

          let alertId = existing?.id as string | undefined;
          const boat = (device as any).boats ?? null;
          const nowIso = new Date().toISOString();

          if (!alertId) {
            const { data: created, error: aErr } = await supabaseAdmin
              .from("sos_alerts")
              .insert({
                device_id: device.id,
                boat_id: device.boat_id,
                fisherman_id: boat?.owner_fisherman_id ?? null,
                bmu_id: boat?.bmu_id ?? null,
                status: "new",
                last_lat: body.lat,
                last_lng: body.lng,
                last_accuracy: body.accuracy ?? null,
                last_ping_at: nowIso,
                battery: body.battery ?? null,
                emergency_level: body.level ?? null,
              })
              .select("id")
              .single();
            if (aErr) throw aErr;
            alertId = created.id;
          } else {
            await supabaseAdmin
              .from("sos_alerts")
              .update({
                last_lat: body.lat,
                last_lng: body.lng,
                last_accuracy: body.accuracy ?? null,
                last_ping_at: nowIso,
                ...(body.battery != null ? { battery: body.battery } : {}),
                ...(body.level ? { emergency_level: body.level } : {}),
              })
              .eq("id", alertId);
          }

          await supabaseAdmin.from("gps_logs").insert({
            alert_id: alertId,
            device_id: device.id,
            lat: body.lat,
            lng: body.lng,
            accuracy: body.accuracy ?? null,
            battery: body.battery ?? null,
          });

          await supabaseAdmin
            .from("devices")
            .update({ last_seen_at: nowIso })
            .eq("id", device.id);

          return Response.json({ alert_id: alertId, received_at: nowIso }, { headers: cors });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return Response.json({ error: msg }, { status: 400, headers: cors });
        }
      },
    },
  },
});
