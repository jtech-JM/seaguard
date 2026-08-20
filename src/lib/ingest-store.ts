/**
 * Supabase implementation of the ingest storage port.
 *
 * Uses the service-role client, so RLS is bypassed — every method here runs with
 * full database rights and must only ever be reached through the authenticated
 * ingest core. All PostgREST specifics (column names, error shapes, join paths)
 * are confined to this file; results are mapped straight back into the typed
 * port in `ingest-types.ts`.
 *
 * The query builder is typed loosely on purpose:
 * `src/integrations/supabase/types.ts` is generated and lags the migrations, so
 * binding these calls to it produces false errors rather than real safety.
 */
import type {
  AlertPositionPatch,
  AlertOwnerContext,
  CreateAlertInput,
  DeviceRecord,
  GpsLogInput,
  IngestLogEntry,
  IngestStore,
  OpenAlertRecord,
} from "@/lib/ingest-types";
import { DuplicateEventError } from "@/lib/ingest-types";
import { OPEN_ALERT_STATUSES } from "@/lib/ingest-core";

type Row = Record<string, unknown>;
type QueryResult = { data: unknown; error: unknown };
type QueryBuilder = Record<string, (...args: unknown[]) => QueryBuilder> & PromiseLike<QueryResult>;

type Db = {
  from: (table: string) => QueryBuilder;
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<QueryResult>;
};

function assertOk(result: QueryResult, what: string) {
  if (!result.error) return;
  const message =
    typeof result.error === "object" && result.error !== null && "message" in result.error
      ? String((result.error as { message: unknown }).message)
      : String(result.error);
  throw new Error(`${what}: ${message}`);
}

/** PostgREST surfaces a unique-constraint violation as SQLSTATE 23505. */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    String((error as { code: unknown }).code) === "23505"
  );
}

function oneRow(result: QueryResult, what: string): Row | null {
  assertOk(result, what);
  return (result.data as Row | null) ?? null;
}

function manyRows(result: QueryResult, what: string): Row[] {
  assertOk(result, what);
  return (result.data as Row[] | null) ?? [];
}

const str = (row: Row, key: string) => (row[key] == null ? null : String(row[key]));
const requiredStr = (row: Row, key: string, what: string) => {
  const value = str(row, key);
  if (value === null) throw new Error(`${what}: missing ${key}`);
  return value;
};

export function createSupabaseIngestStore(db: Db): IngestStore {
  return {
    async findDevice(deviceId: string): Promise<DeviceRecord | null> {
      const row = oneRow(
        await db
          .from("devices")
          .select("id, device_id, fisherman_id, active, device_secret_hash")
          .eq("device_id", deviceId)
          .maybeSingle(),
        "device lookup",
      );
      if (!row) return null;
      return {
        id: requiredStr(row, "id", "device lookup"),
        deviceId: requiredStr(row, "device_id", "device lookup"),
        fishermanId: str(row, "fisherman_id"),
        active: row.active === true,
        secret: str(row, "device_secret_hash") ?? "",
      };
    },

    async findOpenAlerts(deviceUuid: string): Promise<OpenAlertRecord[]> {
      // Deliberately a list, not `.maybeSingle()`: the software SOS path can
      // leave more than one open alert on a device, and `.maybeSingle()` turns
      // that into an error the old code swallowed — creating yet another
      // duplicate alert on every subsequent press.
      const rows = manyRows(
        await db
          .from("sos_alerts")
          .select("id, status, acknowledged_at, fisherman_id, notes, started_at")
          .eq("device_id", deviceUuid)
          .in("status", OPEN_ALERT_STATUSES)
          .order("started_at", { ascending: false })
          .limit(20),
        "open alert lookup",
      );
      return rows.map((row) => ({
        id: requiredStr(row, "id", "open alert lookup"),
        status: str(row, "status") ?? "",
        acknowledgedAt: str(row, "acknowledged_at"),
        fishermanId: str(row, "fisherman_id"),
        notes: str(row, "notes"),
        startedAt: str(row, "started_at"),
      }));
    },

    async findAlertByEventId(deviceUuid: string, eventId: string) {
      const row = oneRow(
        await db
          .from("sos_alerts")
          .select("id")
          .eq("device_id", deviceUuid)
          .eq("ingest_event_id", eventId)
          .limit(1)
          .maybeSingle(),
        "event id lookup",
      );
      return row ? { id: requiredStr(row, "id", "event id lookup") } : null;
    },

    async resolveAlertOwner(fishermanId: string): Promise<AlertOwnerContext> {
      const fisherman = oneRow(
        await db.from("fishermen").select("bmu_id").eq("id", fishermanId).maybeSingle(),
        "fisherman lookup",
      );
      const trip = oneRow(
        await db
          .from("sea_trips")
          .select("boat_id")
          .eq("captain_id", fishermanId)
          .in("status", [
            "pending_approval",
            "checked_out",
            "at_sea",
            "sos",
            "rescue_in_progress",
            "overdue",
          ])
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        "active trip lookup",
      );
      return {
        bmuId: fisherman ? str(fisherman, "bmu_id") : null,
        boatId: trip ? str(trip, "boat_id") : null,
      };
    },

    async createAlert(input: CreateAlertInput) {
      const result = await db
        .from("sos_alerts")
        .insert({
          device_id: input.deviceUuid,
          boat_id: input.boatId,
          fisherman_id: input.fishermanId,
          bmu_id: input.bmuId,
          status: "new",
          last_lat: input.lat,
          last_lng: input.lng,
          last_accuracy: input.accuracy,
          last_ping_at: input.pingedAt,
          battery: input.battery,
          emergency_level: input.level,
          ingest_event_id: input.eventId,
          notes: input.notes,
        })
        .select("id")
        .single();

      // 23505 on this insert means the (device_id, ingest_event_id) unique index
      // rejected it: a concurrent retry of the same SOS inserted first. That is
      // the idempotency guard working, not a storage fault, so it is reported as
      // a duplicate rather than left to surface as a 503.
      if (input.eventId && isUniqueViolation(result.error)) {
        throw new DuplicateEventError(input.eventId);
      }

      const row = oneRow(result, "alert insert");
      if (!row) throw new Error("alert insert: no row returned");
      return { id: requiredStr(row, "id", "alert insert") };
    },

    async updateAlertPosition(alertId: string, patch: AlertPositionPatch) {
      // Only overwrite a stored position with a real one — a later ping without
      // a fix must not blank out the last known coordinates on the map.
      assertOk(
        await db
          .from("sos_alerts")
          .update({
            ...(patch.lat != null && patch.lng != null
              ? { last_lat: patch.lat, last_lng: patch.lng, last_accuracy: patch.accuracy }
              : {}),
            last_ping_at: patch.pingedAt,
            ...(patch.battery != null ? { battery: patch.battery } : {}),
            ...(patch.level ? { emergency_level: patch.level } : {}),
          })
          .eq("id", alertId),
        "alert position update",
      );
    },

    async insertGpsLog(input: GpsLogInput) {
      assertOk(
        await db.from("gps_logs").insert({
          alert_id: input.alertId,
          device_id: input.deviceUuid,
          lat: input.lat,
          lng: input.lng,
          accuracy: input.accuracy,
          battery: input.battery,
        }),
        "gps log insert",
      );
    },

    async touchDevice(deviceUuid: string, seenAtIso: string) {
      assertOk(
        await db.from("devices").update({ last_seen_at: seenAtIso }).eq("id", deviceUuid),
        "device last_seen update",
      );
    },

    async cancelAlerts(input) {
      // Single RPC so alert closure, rescue-operation closure and trip
      // restoration either all land or none do. Doing it as three separate
      // client calls left the system half-cancelled whenever one failed.
      assertOk(
        await db.rpc("hardware_cancel_sos", {
          p_alert_ids: input.alertIds,
          p_fisherman_id: input.fishermanId,
          p_reason: input.reason,
        }),
        "hardware cancel rpc",
      );
    },

    async notifyRescueOfCancel(input) {
      assertOk(
        await db.from("notifications").insert({
          alert_id: input.alertId,
          channel: "dashboard",
          payload: {
            kind: "sos_cancelled_after_engagement",
            alert_id: input.alertId,
            previous_status: input.previousStatus,
            reason: input.reason,
          },
          status: "sent",
        }),
        "rescue cancel notification",
      );
    },

    async logRequest(entry: IngestLogEntry) {
      // Audit trail is best-effort: it must never turn a delivered SOS into an
      // error, so a failure here is swallowed rather than propagated.
      try {
        await db.rpc("log_ingest_request", {
          p_device_id: entry.deviceId,
          p_source_ip: entry.sourceIp,
          p_endpoint: entry.endpoint,
          p_nonce: entry.traceId,
          p_status_code: entry.statusCode,
          p_error_message: entry.errorMessage,
        });
      } catch {
        // ignored on purpose
      }
    },
  };
}
