/**
 * In-memory `IngestStore` used by the ingest test suites.
 *
 * Models just enough of the schema to exercise the request pipeline end to end
 * without a database: devices, open/closed alerts, GPS logs, notifications and
 * the ingest audit log. Any method can be made to throw via `failOn` so the
 * storage-failure branches are covered too.
 */
import { createHash } from "node:crypto";
import type {
  AlertPositionPatch,
  CreateAlertInput,
  DeviceRecord,
  GpsLogInput,
  IngestLogEntry,
  IngestStore,
  OpenAlertRecord,
} from "@/lib/ingest-types";
import { OPEN_ALERT_STATUSES } from "@/lib/ingest-core";

export function sha256Hex(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export interface FakeAlert {
  id: string;
  deviceUuid: string;
  status: string;
  fishermanId: string | null;
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  battery: number | null;
  level: string | null;
  eventId: string | null;
  notes: string | null;
  startedAt: string;
  acknowledgedAt: string | null;
}

export interface FakeStoreState {
  devices: Map<string, DeviceRecord>;
  alerts: FakeAlert[];
  gpsLogs: GpsLogInput[];
  notifications: { alertId: string; previousStatus: string; reason: string }[];
  logs: IngestLogEntry[];
  lastSeen: Map<string, string>;
  owners: Map<string, { bmuId: string | null; boatId: string | null }>;
  /** Method names that should reject, simulating a storage outage. */
  failOn: Set<keyof IngestStore>;
}

export function createFakeStore(seed?: Partial<FakeStoreState>) {
  let nextId = 1;
  const state: FakeStoreState = {
    devices: new Map(),
    alerts: [],
    gpsLogs: [],
    notifications: [],
    logs: [],
    lastSeen: new Map(),
    owners: new Map(),
    failOn: new Set(),
    ...seed,
  };

  function guard(method: keyof IngestStore) {
    if (state.failOn.has(method)) throw new Error(`simulated storage failure in ${method}`);
  }

  const store: IngestStore = {
    async findDevice(deviceId) {
      guard("findDevice");
      return state.devices.get(deviceId) ?? null;
    },
    async findOpenAlerts(deviceUuid): Promise<OpenAlertRecord[]> {
      guard("findOpenAlerts");
      return state.alerts
        .filter(
          (a) =>
            a.deviceUuid === deviceUuid &&
            (OPEN_ALERT_STATUSES as readonly string[]).includes(a.status),
        )
        .map((a) => ({
          id: a.id,
          status: a.status,
          acknowledgedAt: a.acknowledgedAt,
          fishermanId: a.fishermanId,
          notes: a.notes,
          startedAt: a.startedAt,
        }));
    },
    async findAlertByEventId(deviceUuid, eventId) {
      guard("findAlertByEventId");
      const hit = state.alerts.find((a) => a.deviceUuid === deviceUuid && a.eventId === eventId);
      return hit ? { id: hit.id } : null;
    },
    async resolveAlertOwner(fishermanId) {
      guard("resolveAlertOwner");
      return state.owners.get(fishermanId) ?? { bmuId: null, boatId: null };
    },
    async createAlert(input: CreateAlertInput) {
      guard("createAlert");
      const alert: FakeAlert = {
        id: `alert-${nextId++}`,
        deviceUuid: input.deviceUuid,
        status: "new",
        fishermanId: input.fishermanId,
        lat: input.lat,
        lng: input.lng,
        accuracy: input.accuracy,
        battery: input.battery,
        level: input.level,
        eventId: input.eventId,
        notes: input.notes,
        startedAt: input.pingedAt,
        acknowledgedAt: null,
      };
      state.alerts.push(alert);
      return { id: alert.id };
    },
    async updateAlertPosition(alertId, patch: AlertPositionPatch) {
      guard("updateAlertPosition");
      const alert = state.alerts.find((a) => a.id === alertId);
      if (!alert) throw new Error("alert not found");
      if (patch.lat != null && patch.lng != null) {
        alert.lat = patch.lat;
        alert.lng = patch.lng;
        alert.accuracy = patch.accuracy;
      }
      if (patch.battery != null) alert.battery = patch.battery;
      if (patch.level) alert.level = patch.level;
    },
    async insertGpsLog(input) {
      guard("insertGpsLog");
      state.gpsLogs.push(input);
    },
    async touchDevice(deviceUuid, seenAtIso) {
      guard("touchDevice");
      state.lastSeen.set(deviceUuid, seenAtIso);
    },
    async cancelAlerts({ alertIds }) {
      guard("cancelAlerts");
      for (const alert of state.alerts) {
        if (alertIds.includes(alert.id)) alert.status = "closed";
      }
    },
    async notifyRescueOfCancel(input) {
      guard("notifyRescueOfCancel");
      state.notifications.push(input);
    },
    async logRequest(entry) {
      state.logs.push(entry);
    },
  };

  return { store, state };
}

/** Registers a device and returns the plaintext secret to present in headers. */
export function seedDevice(
  state: FakeStoreState,
  overrides: Partial<DeviceRecord> & { secretPlaintext?: string } = {},
) {
  const secretPlaintext = overrides.secretPlaintext ?? "s".repeat(48);
  const device: DeviceRecord = {
    id: overrides.id ?? "device-uuid-1",
    deviceId: overrides.deviceId ?? "DEV-TEST01",
    fishermanId: overrides.fishermanId ?? "fisherman-1",
    active: overrides.active ?? true,
    secret: overrides.secret ?? sha256Hex(secretPlaintext),
  };
  state.devices.set(device.deviceId, device);
  return { device, secretPlaintext };
}
