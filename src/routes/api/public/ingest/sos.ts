// Public ingest endpoint for hardware SOS triggers.
// Auth: header `x-device-secret: <secret>` — issued per device in the BMU console.
// Body: { device_id: string, lat: number, lng: number, accuracy?: number }
// Creates a new active alert for the device (reuses any open alert) and logs the GPS fix.
// This endpoint is the stable contract for ESP32 + GPS + SIM7600 hardware.
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { checkRateLimit, timingSafeEq } from "@/lib/hardware-ingest";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const Body = z.object({
  device_id: z.string().min(1),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy: z.number().nonnegative().optional(),
  battery: z.number().min(0).max(100).optional(),
  level: z.enum(["LOW", "HIGH"]).optional(),
  timestamp: z.string().datetime().optional(),
  nonce: z.string().min(1).optional(),
});

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, x-device-secret",
};

export const Route = createFileRoute("/api/public/ingest/sos")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: cors }),
      POST: async ({ request }) => {
        try {
          const secret = request.headers.get("x-device-secret") ?? "";
          const sourceIp = request.headers.get("x-forwarded-for") ?? "unknown";
          if (!secret) {
            return Response.json(
              { error: "Invalid device credentials" },
              { status: 401, headers: cors },
            );
          }
          const body = Body.parse(await request.json());
          if (!checkRateLimit(`${body.device_id}:${sourceIp}`)) {
            await (supabaseAdmin.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<unknown>)(
              "log_ingest_request",
              {
                p_device_id: body.device_id,
                p_source_ip: sourceIp,
                p_endpoint: "/api/public/ingest/sos",
                p_nonce: body.nonce ?? null,
                p_status_code: 429,
                p_error_message: "Too many requests",
              },
            );
            return Response.json({ error: "Too many requests" }, { status: 429, headers: cors });
          }

          const { data: device, error: dErr } = await supabaseAdmin
            .from("devices")
            .select("id, fisherman_id, active, device_secret")
            .eq("device_id", body.device_id)
            .maybeSingle();
          if (dErr) throw dErr;
          if (
            !device ||
            !timingSafeEq(secret, (device as { device_secret: string }).device_secret ?? "")
          ) {
            await (supabaseAdmin.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<unknown>)(
              "log_ingest_request",
              {
                p_device_id: body.device_id,
                p_source_ip: sourceIp,
                p_endpoint: "/api/public/ingest/sos",
                p_nonce: body.nonce ?? null,
                p_status_code: 401,
                p_error_message: "Invalid device credentials",
              },
            );
            return Response.json(
              { error: "Invalid device credentials" },
              { status: 401, headers: cors },
            );
          }
          if (!(device as { active: boolean }).active) {
            await (supabaseAdmin.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<unknown>)(
              "log_ingest_request",
              {
                p_device_id: body.device_id,
                p_source_ip: sourceIp,
                p_endpoint: "/api/public/ingest/sos",
                p_nonce: body.nonce ?? null,
                p_status_code: 403,
                p_error_message: "Device disabled",
              },
            );
            return Response.json({ error: "Invalid device credentials" }, { status: 403, headers: cors });
          }

          const { data: existing } = await supabaseAdmin
            .from("sos_alerts")
            .select("id")
            .eq("device_id", device.id)
            .in("status", ["new", "acknowledged", "assigned", "in_progress"])
            .maybeSingle();

          let alertId = existing?.id as string | undefined;

          // Resolve fisherman and bmu from device assignment
          const fishermanId = (device as { fisherman_id: string | null }).fisherman_id ?? null;
          let bmuId: string | null = null;
          let boatId: string | null = null;

          if (fishermanId) {
            // Get bmu_id from the fisherman record
            const { data: fm } = await supabaseAdmin
              .from("fishermen")
              .select("bmu_id")
              .eq("id", fishermanId)
              .maybeSingle();
            bmuId = (fm as { bmu_id: string | null } | null)?.bmu_id ?? null;

            // Best-effort: get boat from the fisherman's active trip
            const { data: activeTrip } = await supabaseAdmin
              .from("sea_trips")
              .select("boat_id")
              .eq("captain_id", fishermanId)
              .in("status", ["pending_approval", "checked_out", "at_sea", "sos", "rescue_in_progress", "overdue"])
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle();
            boatId = (activeTrip as { boat_id: string | null } | null)?.boat_id ?? null;
          }

          const nowIso = new Date().toISOString();

          if (!alertId) {
            const { data: created, error: aErr } = await supabaseAdmin
              .from("sos_alerts")
              .insert({
                device_id: device.id,
                boat_id: boatId,
                fisherman_id: fishermanId,
                bmu_id: bmuId,
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

          await supabaseAdmin.from("devices").update({ last_seen_at: nowIso }).eq("id", device.id);

          await (supabaseAdmin.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<unknown>)(
            "log_ingest_request",
            {
              p_device_id: body.device_id,
              p_source_ip: sourceIp,
              p_endpoint: "/api/public/ingest/sos",
              p_nonce: body.nonce ?? null,
              p_status_code: 200,
              p_error_message: null,
            },
          );
          return Response.json({ alert_id: alertId, received_at: nowIso }, { headers: cors });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return Response.json({ error: msg }, { status: 400, headers: cors });
        }
      },
    },
  },
});
