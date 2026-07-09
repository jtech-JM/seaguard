// Cancels any open SOS for a device (hardware "safe" button).
// Auth: header `x-device-secret: <secret>`.
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const Body = z.object({ device_id: z.string().min(1) });

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

export const Route = createFileRoute("/api/public/ingest/cancel")({
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
            .select("id, device_secret")
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

          await supabaseAdmin
            .from("sos_alerts")
            .update({ status: "closed", resolved_at: new Date().toISOString() })
            .eq("device_id", device.id)
            .in("status", ["new", "acknowledged", "assigned", "in_progress"]);

          const { data: alert } = await supabaseAdmin
            .from("sos_alerts")
            .select("boat_id")
            .eq("device_id", device.id)
            .order("started_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (alert?.boat_id) {
            await supabaseAdmin
              .from("sea_trips")
              .update({ status: "at_sea" })
              .eq("boat_id", alert.boat_id)
              .in("status", ["sos", "rescue_in_progress"]);
          }

          return Response.json({ ok: true }, { headers: cors });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return Response.json({ error: msg }, { status: 400, headers: cors });
        }
      },
    },
  },
});
