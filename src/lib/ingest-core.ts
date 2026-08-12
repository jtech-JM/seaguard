/**
 * Shared request handling for the three public hardware ingest endpoints.
 *
 * The route files under `src/routes/api/public/ingest/` are thin wrappers around
 * the handlers here so that authentication, status-code semantics, idempotency
 * and logging cannot drift between `/sos`, `/location` and `/cancel` — they did
 * before this was extracted.
 *
 * Status-code contract (the firmware depends on it):
 *   200  accepted
 *   400  malformed payload — permanent, do not retry
 *   401  unknown device or bad secret — permanent, do not retry
 *   403  device disabled — permanent, stop retrying
 *   429  rate limited — retry after backoff
 *   503  storage unavailable — retry after backoff
 *   500  unexpected server fault — retry after backoff
 *
 * Anything that is not the device's fault must be a 5xx. Returning 400 for a
 * database outage (the previous behaviour) told the firmware to discard an
 * emergency permanently.
 */
import { z } from "zod";
import type { DeviceRecord, IngestStore, OpenAlertRecord } from "@/lib/ingest-types";

export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, x-device-secret",
} as const;

/** Statuses in which an alert is still an open incident. */
export const OPEN_ALERT_STATUSES = ["new", "acknowledged", "assigned", "in_progress"] as const;

/** Statuses meaning a rescue officer has already engaged with the incident. */
export const ENGAGED_ALERT_STATUSES = ["acknowledged", "assigned", "in_progress"] as const;

/** Clock skew tolerated on a device-supplied `timestamp`, in milliseconds. */
export const TIMESTAMP_SKEW_TOLERANCE_MS = 10 * 60_000;

const deviceId = z.string().min(1).max(64);
const eventId = z.string().min(1).max(64).optional();
const timestamp = z.string().datetime().optional();
const battery = z.number().min(0).max(100).optional();
const accuracy = z.number().nonnegative().finite().optional();
const lat = z.number().min(-90).max(90);
const lng = z.number().min(-180).max(180);

/**
 * An SOS is accepted without coordinates. A distress call must never be dropped
 * because the GPS module has no fix — the incident is what matters, and the
 * position follows on the next `/location` ping.
 */
export const SosBody = z.object({
  device_id: deviceId,
  lat: lat.optional(),
  lng: lng.optional(),
  accuracy,
  battery,
  level: z.enum(["LOW", "HIGH"]).optional(),
  gps_fix: z.boolean().optional(),
  event_id: eventId,
  timestamp,
});

/** A location ping without coordinates carries no information, so they are required. */
export const LocationBody = z.object({
  device_id: deviceId,
  lat,
  lng,
  accuracy,
  battery,
  level: z.enum(["LOW", "HIGH"]).optional(),
  event_id: eventId,
  timestamp,
});

export const CancelBody = z.object({
  device_id: deviceId,
  reason: z.string().max(500).optional(),
  event_id: eventId,
  timestamp,
});

export interface IngestDeps {
  store: IngestStore;
  /** Best-effort in-process throttle. Returns false when the caller is over budget. */
  rateLimit: (key: string, limit: number) => boolean;
  now: () => Date;
  newTraceId: () => string;
  /** Structured server-side log sink. Never receives secrets. */
  log?: (event: Record<string, unknown>) => void;
}

interface Failure {
  status: number;
  error: string;
  /** Detail recorded server-side only — never returned to the caller. */
  internal?: string;
}

class IngestError extends Error {
  constructor(readonly failure: Failure) {
    super(failure.error);
  }
}

function fail(status: number, error: string, internal?: string): never {
  throw new IngestError({ status, error, internal });
}

/**
 * Constant-time comparison over the full length of both inputs.
 *
 * Compares SHA-256 digests rather than the raw secrets, so both operands are
 * always 64 hex characters and the loop cannot leak the secret's length.
 */
export function secretMatches(
  presented: string,
  storedHash: string,
  sha256: (s: string) => string,
) {
  if (!presented || !storedHash) return false;
  const presentedHash = sha256(presented);
  if (presentedHash.length !== storedHash.length) return false;
  let diff = 0;
  for (let i = 0; i < presentedHash.length; i++) {
    diff |= presentedHash.charCodeAt(i) ^ storedHash.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * `0,0` is the default TinyGPS++ reading when no fix has been acquired. Treating
 * it as a real position drops rescue markers in the Gulf of Guinea, thousands of
 * kilometres from any Kenyan BMU, so it is rejected as "no fix".
 */
export function hasUsableFix(
  latitude: number | undefined,
  longitude: number | undefined,
  gpsFix?: boolean,
): latitude is number {
  if (gpsFix === false) return false;
  if (latitude == null || longitude == null) return false;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
  return !(latitude === 0 && longitude === 0);
}

export function timestampIsFresh(iso: string | undefined, now: Date) {
  if (!iso) return true;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  return Math.abs(now.getTime() - t) <= TIMESTAMP_SKEW_TOLERANCE_MS;
}

function json(body: unknown, status: number, traceId: string) {
  return Response.json(body, {
    status,
    headers: { ...CORS_HEADERS, "x-seaguard-trace": traceId },
  });
}

async function readBody(request: Request) {
  try {
    return await request.json();
  } catch {
    fail(400, "Malformed JSON body");
  }
}

function parse<T extends z.ZodTypeAny>(schema: T, raw: unknown): z.infer<T> {
  const result = schema.safeParse(raw);
  if (!result.success) {
    // Field paths are safe to return (they come from our own schema); raw values
    // and internal messages are not echoed back.
    const fields = result.error.issues.map((i) => i.path.join(".")).filter(Boolean);
    fail(
      400,
      fields.length
        ? `Invalid payload fields: ${[...new Set(fields)].join(", ")}`
        : "Invalid payload",
    );
  }
  return result.data;
}

/**
 * Authenticate before rate limiting.
 *
 * Throttling on an unauthenticated `device_id` would let anyone who learns a
 * device label push that device over its budget and suppress its next real SOS.
 * Unauthenticated traffic is throttled per source IP instead.
 */
async function authenticate(
  deps: IngestDeps,
  request: Request,
  body: { device_id: string },
  sourceIp: string,
  sha256: (s: string) => string,
): Promise<DeviceRecord> {
  const presented = request.headers.get("x-device-secret") ?? "";
  if (!presented) fail(401, "Invalid device credentials", "missing x-device-secret header");

  if (!deps.rateLimit(`auth:${sourceIp}`, 120)) {
    fail(429, "Too many requests", "unauthenticated rate limit");
  }

  let device: DeviceRecord | null;
  try {
    device = await deps.store.findDevice(body.device_id);
  } catch (e) {
    fail(503, "Service temporarily unavailable", `device lookup failed: ${describe(e)}`);
  }

  // Identical response for "no such device" and "wrong secret" so the endpoint
  // cannot be used to enumerate valid device IDs.
  if (!device || !secretMatches(presented, device.secret, sha256)) {
    fail(401, "Invalid device credentials", device ? "secret mismatch" : "unknown device id");
  }
  if (!device.active) fail(403, "Device disabled", "device is deactivated");
  return device;
}

function describe(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

/** Newest open alert first; tolerates the multi-open-alert case rather than erroring. */
function newestOpenAlert(alerts: OpenAlertRecord[]): OpenAlertRecord | null {
  if (alerts.length === 0) return null;
  return [...alerts].sort((a, b) => {
    const at = a.startedAt ? new Date(a.startedAt).getTime() : 0;
    const bt = b.startedAt ? new Date(b.startedAt).getTime() : 0;
    return bt - at;
  })[0];
}

type Endpoint =
  "/api/public/ingest/sos" | "/api/public/ingest/location" | "/api/public/ingest/cancel";

/**
 * Shared envelope: trace id, body parse, auth, per-device throttle, error
 * mapping, ingest logging. `run` sees an authenticated device and a valid body.
 */
async function handle<T extends { device_id: string; timestamp?: string; event_id?: string }>(
  deps: IngestDeps,
  request: Request,
  opts: {
    endpoint: Endpoint;
    schema: z.ZodType<T>;
    perDeviceLimit: number;
    sha256: (s: string) => string;
    run: (ctx: {
      device: DeviceRecord;
      body: T;
      nowIso: string;
      traceId: string;
    }) => Promise<unknown>;
  },
) {
  const traceId = deps.newTraceId();
  const sourceIp = (request.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
  let deviceLabel: string | null = null;

  try {
    const body = parse(opts.schema, await readBody(request));
    deviceLabel = body.device_id;

    if (!timestampIsFresh(body.timestamp, deps.now())) {
      fail(400, "Request timestamp outside accepted window");
    }

    const device = await authenticate(deps, request, body, sourceIp, opts.sha256);

    if (!deps.rateLimit(`device:${device.id}:${opts.endpoint}`, opts.perDeviceLimit)) {
      fail(429, "Too many requests", "per-device rate limit");
    }

    const nowIso = deps.now().toISOString();
    const payload = await opts.run({ device, body, nowIso, traceId });

    void deps.store
      .logRequest({
        traceId,
        deviceId: deviceLabel,
        sourceIp,
        endpoint: opts.endpoint,
        statusCode: 200,
        errorMessage: null,
      })
      .catch(() => {});
    deps.log?.({ traceId, endpoint: opts.endpoint, device_id: deviceLabel, status: 200 });
    return json(payload, 200, traceId);
  } catch (e) {
    const failure: Failure =
      e instanceof IngestError
        ? e.failure
        : { status: 500, error: "Internal server error", internal: describe(e) };

    void deps.store
      .logRequest({
        traceId,
        deviceId: deviceLabel,
        sourceIp,
        endpoint: opts.endpoint,
        statusCode: failure.status,
        errorMessage: failure.internal ?? failure.error,
      })
      .catch(() => {});
    deps.log?.({
      traceId,
      endpoint: opts.endpoint,
      device_id: deviceLabel,
      status: failure.status,
      reason: failure.internal ?? failure.error,
    });
    return json({ error: failure.error }, failure.status, traceId);
  }
}

// ── /sos ────────────────────────────────────────────────────────────────────

export function handleSos(deps: IngestDeps, request: Request, sha256: (s: string) => string) {
  return handle(deps, request, {
    endpoint: "/api/public/ingest/sos",
    schema: SosBody,
    // Generous: a device retrying a failed emergency must never be throttled out.
    perDeviceLimit: 60,
    sha256,
    run: async ({ device, body, nowIso, traceId }) => {
      const fix = hasUsableFix(body.lat, body.lng, body.gps_fix);
      const position = {
        lat: fix ? (body.lat as number) : null,
        lng: fix ? (body.lng as number) : null,
        accuracy: fix ? (body.accuracy ?? null) : null,
      };

      try {
        // 1. Idempotency — the same device event replayed after a lost response.
        if (body.event_id) {
          const known = await deps.store.findAlertByEventId(device.id, body.event_id);
          if (known) {
            await deps.store.touchDevice(device.id, nowIso);
            return { alert_id: known.id, received_at: nowIso, duplicate: true, trace_id: traceId };
          }
        }

        // 2. Reuse any already-open incident for this device.
        const open = newestOpenAlert(await deps.store.findOpenAlerts(device.id));
        let alertId = open?.id ?? null;

        if (alertId) {
          await deps.store.updateAlertPosition(alertId, {
            ...position,
            battery: body.battery ?? null,
            level: body.level ?? null,
            pingedAt: nowIso,
          });
        } else {
          const owner = device.fishermanId
            ? await deps.store.resolveAlertOwner(device.fishermanId)
            : { bmuId: null, boatId: null };

          const created = await deps.store.createAlert({
            deviceUuid: device.id,
            fishermanId: device.fishermanId,
            bmuId: owner.bmuId,
            boatId: owner.boatId,
            ...position,
            battery: body.battery ?? null,
            level: body.level ?? null,
            eventId: body.event_id ?? null,
            notes: fix ? null : "Triggered without a GPS fix — position pending",
            pingedAt: nowIso,
          });
          alertId = created.id;
        }

        if (fix) {
          await deps.store.insertGpsLog({
            alertId,
            deviceUuid: device.id,
            lat: body.lat as number,
            lng: body.lng as number,
            accuracy: body.accuracy ?? null,
            battery: body.battery ?? null,
          });
        }
        await deps.store.touchDevice(device.id, nowIso);

        return {
          alert_id: alertId,
          received_at: nowIso,
          gps_fix: fix,
          duplicate: Boolean(open),
          trace_id: traceId,
        };
      } catch (e) {
        if (e instanceof IngestError) throw e;
        fail(503, "Service temporarily unavailable", `sos write failed: ${describe(e)}`);
      }
    },
  });
}

// ── /location ───────────────────────────────────────────────────────────────

export function handleLocation(deps: IngestDeps, request: Request, sha256: (s: string) => string) {
  return handle(deps, request, {
    endpoint: "/api/public/ingest/location",
    schema: LocationBody,
    // 15s cadence = 4/min; 20 leaves headroom for retries without inviting abuse.
    perDeviceLimit: 20,
    sha256,
    run: async ({ device, body, nowIso, traceId }) => {
      if (!hasUsableFix(body.lat, body.lng)) {
        fail(400, "Invalid payload fields: lat, lng");
      }
      try {
        const open = newestOpenAlert(await deps.store.findOpenAlerts(device.id));

        await deps.store.insertGpsLog({
          alertId: open?.id ?? null,
          deviceUuid: device.id,
          lat: body.lat,
          lng: body.lng,
          accuracy: body.accuracy ?? null,
          battery: body.battery ?? null,
        });

        if (open) {
          await deps.store.updateAlertPosition(open.id, {
            lat: body.lat,
            lng: body.lng,
            accuracy: body.accuracy ?? null,
            battery: body.battery ?? null,
            level: body.level ?? null,
            pingedAt: nowIso,
          });
        }
        await deps.store.touchDevice(device.id, nowIso);

        return { ok: true, alert_id: open?.id ?? null, received_at: nowIso, trace_id: traceId };
      } catch (e) {
        if (e instanceof IngestError) throw e;
        fail(503, "Service temporarily unavailable", `location write failed: ${describe(e)}`);
      }
    },
  });
}

// ── /cancel ─────────────────────────────────────────────────────────────────

export function handleCancel(deps: IngestDeps, request: Request, sha256: (s: string) => string) {
  return handle(deps, request, {
    endpoint: "/api/public/ingest/cancel",
    schema: CancelBody,
    perDeviceLimit: 20,
    sha256,
    run: async ({ device, body, nowIso, traceId }) => {
      const reason = body.reason?.trim() || "Cancelled from device";
      try {
        const open = await deps.store.findOpenAlerts(device.id);
        if (open.length === 0) {
          return { ok: true, cancelled: 0, received_at: nowIso, trace_id: traceId };
        }

        await deps.store.cancelAlerts({
          alertIds: open.map((a) => a.id),
          fishermanId: newestOpenAlert(open)?.fishermanId ?? null,
          reason,
        });

        // A cancel that arrives after rescue has engaged must not silently erase
        // the response — the officers who were dispatched are told about it.
        const engaged = open.filter((a) =>
          (ENGAGED_ALERT_STATUSES as readonly string[]).includes(a.status),
        );
        for (const alert of engaged) {
          await deps.store
            .notifyRescueOfCancel({
              alertId: alert.id,
              previousStatus: alert.status,
              reason,
            })
            .catch(() => {});
        }
        await deps.store.touchDevice(device.id, nowIso);

        return {
          ok: true,
          cancelled: open.length,
          notified_rescue: engaged.length,
          received_at: nowIso,
          trace_id: traceId,
        };
      } catch (e) {
        if (e instanceof IngestError) throw e;
        fail(503, "Service temporarily unavailable", `cancel write failed: ${describe(e)}`);
      }
    },
  });
}

export function corsPreflight() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
