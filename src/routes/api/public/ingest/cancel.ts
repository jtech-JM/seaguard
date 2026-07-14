// Cancels any open SOS for a device (hardware "safe" button).
// Auth: header `x-device-secret: <secret>`.
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { buildRescueOperationPatch, buildSosCancelPatch, shouldRestoreTripStatus } from "@/lib/sos-cancel";
import { checkRateLimit, timingSafeEq } from "@/lib/hardware-ingest";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const Body = z.object({
  device_id: z.string().min(1),
  timestamp: z.string().datetime().optional(),
  nonce: z.string().min(1).optional(),
});

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, x-device-secret",
};

export const Route = createFileRoute("/api/public/ingest/cancel")({
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
                p_endpoint: "/api/public/ingest/cancel",
                p_nonce: body.nonce ?? null,
                p_status_code: 429,
                p_error_message: "Too many requests",
              },
            );
            return Response.json({ error: "Too many requests" }, { status: 429, headers: cors });
          }

          const { data: device } = await supabaseAdmin
            .from("devices")
            .select("id, active, device_secret")
            .eq("device_id", body.device_id)
            .maybeSingle();
          if (
            !device ||
            !timingSafeEq(secret, (device as { device_secret: string }).device_secret ?? "")
          ) {
            await (supabaseAdmin.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<unknown>)(
              "log_ingest_request",
              {
                p_device_id: body.device_id,
                p_source_ip: sourceIp,
                p_endpoint: "/api/public/ingest/cancel",
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
                p_endpoint: "/api/public/ingest/cancel",
                p_nonce: body.nonce ?? null,
                p_status_code: 403,
                p_error_message: "Device disabled",
              },
            );
            return Response.json({ error: "Invalid device credentials" }, { status: 403, headers: cors });
          }

          const { data: alerts } = await supabaseAdmin
            .from("sos_alerts")
            .select("id, boat_id, status, notes, started_at")
            .eq("device_id", device.id)
            .in("status", ["new", "acknowledged", "assigned", "in_progress"]);

          const activeAlertIds = (alerts ?? []).map((alert) => alert.id);
          if (activeAlertIds.length > 0) {
            const patch = buildSosCancelPatch(null, "Hardware cancel");
            const rescuePatch = buildRescueOperationPatch(null, "Hardware cancel");
            await supabaseAdmin.from("sos_alerts").update(patch).in("id", activeAlertIds);
            await supabaseAdmin.from("rescue_operations").update(rescuePatch).in("alert_id", activeAlertIds);
          }

          const latestAlert = (alerts ?? []).sort((a, b) => {
            const aTime = a.started_at ? new Date(a.started_at).getTime() : 0;
            const bTime = b.started_at ? new Date(b.started_at).getTime() : 0;
            return bTime - aTime;
          })[0];

          if (latestAlert?.boat_id) {
            await supabaseAdmin
              .from("sea_trips")
              .update({ status: "at_sea" })
              .eq("boat_id", latestAlert.boat_id)
              .in("status", ["sos", "rescue_in_progress"]);
          }

          await (supabaseAdmin.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<unknown>)(
            "log_ingest_request",
            {
              p_device_id: body.device_id,
              p_source_ip: sourceIp,
              p_endpoint: "/api/public/ingest/cancel",
              p_nonce: body.nonce ?? null,
              p_status_code: 200,
              p_error_message: null,
            },
          );
          return Response.json({ ok: true }, { headers: cors });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return Response.json({ error: msg }, { status: 400, headers: cors });
        }
      },
    },
  },
});
