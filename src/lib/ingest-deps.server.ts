/**
 * Server-only wiring for the ingest endpoints.
 *
 * Kept in a `.server.ts` module and imported dynamically so the service-role
 * Supabase client is never pulled into a client bundle.
 */
import type { IngestDeps } from "@/lib/ingest-core";
import { createSupabaseIngestStore } from "@/lib/ingest-store";
import { checkRateLimit, newTraceId } from "@/lib/hardware-ingest";

export async function createIngestDeps(): Promise<IngestDeps> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return {
    store: createSupabaseIngestStore(supabaseAdmin as never),
    rateLimit: (key, limit) => checkRateLimit(key, limit),
    now: () => new Date(),
    newTraceId,
    // Single-line structured record per ingest request. Carries a trace id and
    // the device label only — never the secret, and never the raw payload.
    log: (event) => console.log(JSON.stringify({ scope: "ingest", ...event })),
  };
}
