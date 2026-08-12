/**
 * Storage port for the hardware ingest endpoints.
 *
 * The ingest core (`ingest-core.ts`) depends only on this interface, never on
 * Supabase directly. That keeps the request/response contract — status codes,
 * auth ordering, idempotency, error shaping — testable without a database, and
 * confines PostgREST specifics to `ingest-store.ts`.
 *
 * Every method rejects on storage failure. The core translates a rejection into
 * a retryable 503 rather than letting it surface as a permanent 4xx.
 */

export interface DeviceRecord {
  /** `devices.id` (uuid) — the foreign key used by alerts and GPS logs. */
  id: string;
  /** `devices.device_id` — the human-readable label flashed into firmware. */
  deviceId: string;
  fishermanId: string | null;
  active: boolean;
  secret: string;
}

export interface OpenAlertRecord {
  id: string;
  status: string;
  acknowledgedAt: string | null;
  fishermanId: string | null;
  notes: string | null;
  startedAt: string | null;
}

export interface AlertOwnerContext {
  bmuId: string | null;
  boatId: string | null;
}

export interface CreateAlertInput {
  deviceUuid: string;
  fishermanId: string | null;
  bmuId: string | null;
  boatId: string | null;
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  battery: number | null;
  level: "LOW" | "HIGH" | null;
  eventId: string | null;
  notes: string | null;
  pingedAt: string;
}

export interface AlertPositionPatch {
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  battery: number | null;
  level: "LOW" | "HIGH" | null;
  pingedAt: string;
}

export interface GpsLogInput {
  alertId: string | null;
  deviceUuid: string;
  lat: number;
  lng: number;
  accuracy: number | null;
  battery: number | null;
}

export interface IngestLogEntry {
  traceId: string;
  deviceId: string | null;
  sourceIp: string;
  endpoint: string;
  statusCode: number;
  errorMessage: string | null;
}

export interface IngestStore {
  findDevice(deviceId: string): Promise<DeviceRecord | null>;
  /** All alerts for the device in an open status, newest first. */
  findOpenAlerts(deviceUuid: string): Promise<OpenAlertRecord[]>;
  /** Idempotency lookup: an alert already created for this device event. */
  findAlertByEventId(deviceUuid: string, eventId: string): Promise<{ id: string } | null>;
  resolveAlertOwner(fishermanId: string): Promise<AlertOwnerContext>;
  createAlert(input: CreateAlertInput): Promise<{ id: string }>;
  updateAlertPosition(alertId: string, patch: AlertPositionPatch): Promise<void>;
  insertGpsLog(input: GpsLogInput): Promise<void>;
  touchDevice(deviceUuid: string, seenAtIso: string): Promise<void>;
  /** Close alerts + linked rescue operations and restore the trip, atomically. */
  cancelAlerts(input: {
    alertIds: string[];
    fishermanId: string | null;
    reason: string;
  }): Promise<void>;
  /** Dashboard notification when a cancel arrives after rescue engagement. */
  notifyRescueOfCancel(input: {
    alertId: string;
    previousStatus: string;
    reason: string;
  }): Promise<void>;
  logRequest(entry: IngestLogEntry): Promise<void>;
}
