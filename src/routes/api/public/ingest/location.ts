// Continuous location updates from a hardware device.
// Auth: header `x-device-secret: <secret>`.
// Body: { device_id, lat, lng, accuracy? }
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const Body = z.object({
  device_id: z.string().min(1),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy: z.number().nonnegative().optional(),
  battery: z.number().min(0).max(100).optional(),
  level: z.enum(["LOW", "HIGH"]).optional(),
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

export const Route = createFileRoute("/api/public/ingest/location")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: cors }),
      POST: async ({ request }) => {
        try {
          const secret = request.headers.get("x-device-secret") ?? "";
          if (!secret) {
            return Response.json(
              { error: "Missing x-device-secret" },
              { status: 401, headers: cors },
            );
          }
          const body = Body.parse(await request.json());
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          const { data: device } = await supabaseAdmin
            .from("devices")
            .select("id, active, device_secret")
            .eq("device_id", body.device_id)
            .maybeSingle();
          if (
            !device ||
            !timingSafeEq(secret, (device as { device_secret: string }).device_secret ?? "")
          ) {
            return Response.json(
              { error: "Invalid device credentials" },
              { status: 401, headers: cors },
            );
          }
          if (!(device as { active: boolean }).active) {
            return Response.json({ error: "Device disabled" }, { status: 403, headers: cors });
          }

          const { data: alert } = await supabaseAdmin
            .from("sos_alerts")
            .select("id")
            .eq("device_id", device.id)
            .in("status", ["new", "acknowledged", "assigned", "in_progress"])
            .order("started_at", { ascending: false })
            .maybeSingle();

          const nowIso = new Date().toISOString();

          await supabaseAdmin.from("gps_logs").insert({
            alert_id: alert?.id ?? null,
            device_id: device.id,
            lat: body.lat,
            lng: body.lng,
            accuracy: body.accuracy ?? null,
            battery: body.battery ?? null,
          });

          if (alert?.id) {
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
              .eq("id", alert.id);
          }

          await supabaseAdmin.from("devices").update({ last_seen_at: nowIso }).eq("id", device.id);

          return Response.json(
            { ok: true, alert_id: alert?.id ?? null, received_at: nowIso },
            { headers: cors },
          );
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return Response.json({ error: msg }, { status: 400, headers: cors });
        }
      },
    },
  },
});
