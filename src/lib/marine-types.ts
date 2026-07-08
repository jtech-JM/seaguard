// Shared types for the Marine Rescue platform.
export type AlertStatus =
  "new" | "acknowledged" | "assigned" | "in_progress" | "resolved" | "closed";

export const ALERT_STATUSES: AlertStatus[] = [
  "new",
  "acknowledged",
  "assigned",
  "in_progress",
  "resolved",
  "closed",
];

export const ALERT_STATUS_LABEL: Record<AlertStatus, string> = {
  new: "New Alert",
  acknowledged: "Acknowledged",
  assigned: "Team Assigned",
  in_progress: "In Progress",
  resolved: "Resolved",
  closed: "Closed",
};

export const ACTIVE_STATUSES: AlertStatus[] = ["new", "acknowledged", "assigned", "in_progress"];

export interface BMU {
  id: string;
  name: string;
  region: string | null;
  contact_phone: string | null;
  contact_email: string | null;
}

export interface Fisherman {
  id: string;
  bmu_id: string | null;
  full_name: string;
  phone: string | null;
  national_id: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  photo_url: string | null;
  active: boolean;
}

export interface Boat {
  id: string;
  name: string;
  registration_number: string | null;
  boat_type: string | null;
  owner_fisherman_id: string | null;
  bmu_id: string | null;
}

export interface Device {
  id: string;
  device_id: string;
  device_secret: string;
  boat_id: string | null;
  hardware_type: string | null;
  active: boolean;
  last_seen_at: string | null;
}

export interface SOSAlertRow {
  id: string;
  device_id: string;
  boat_id: string | null;
  fisherman_id: string | null;
  bmu_id: string | null;
  status: AlertStatus;
  started_at: string;
  acknowledged_at: string | null;
  resolved_at: string | null;
  last_lat: number | null;
  last_lng: number | null;
  last_accuracy: number | null;
  last_ping_at: string | null;
  notes: string | null;
  battery: number | null;
  emergency_level: "LOW" | "HIGH" | null;
}

export const EMERGENCY_LEVEL_COLOR: Record<string, string> = {
  LOW: "text-tide",
  HIGH: "text-distress",
};

export interface GpsLog {
  id: string;
  alert_id: string | null;
  device_id: string;
  lat: number;
  lng: number;
  accuracy: number | null;
  recorded_at: string;
}

// ── Trip status ──────────────────────────────────────────────────
export type TripStatus =
  | "planned"
  | "pending_approval"
  | "checked_out"
  | "at_sea"
  | "sos"
  | "rescue_in_progress"
  | "rescued"
  | "returned"
  | "overdue"
  | "cancelled";

export const TRIP_STATUS_LABEL: Record<TripStatus, string> = {
  planned: "Planned",
  pending_approval: "Pending Approval",
  checked_out: "Checked Out",
  at_sea: "At Sea",
  sos: "SOS Active",
  rescue_in_progress: "Rescue In Progress",
  rescued: "Rescued",
  returned: "Returned",
  overdue: "Overdue",
  cancelled: "Cancelled",
};

export const TRIP_STATUS_TONE: Record<TripStatus, "tide" | "distress" | "warn" | "muted"> = {
  planned: "muted",
  pending_approval: "warn",
  checked_out: "tide",
  at_sea: "tide",
  sos: "distress",
  rescue_in_progress: "distress",
  rescued: "tide",
  returned: "muted",
  overdue: "distress",
  cancelled: "muted",
};

// ── Rescue operation ─────────────────────────────────────────────
export interface RescueOperation {
  id: string;
  alert_id: string;
  team_name: string | null;
  status: AlertStatus;
  notes: string | null;
  started_at: string;
  ended_at: string | null;
  assigned_by: string | null;
}

// ── Trip crew ────────────────────────────────────────────────────
export interface TripCrewMember {
  id: string;
  trip_id: string;
  fisherman_id: string;
  role: string | null;
  fisherman?: { full_name: string; phone: string | null } | null;
}

// ── Notification ─────────────────────────────────────────────────
export type NotificationChannel = "dashboard" | "sms" | "email" | "whatsapp";
export type NotificationStatus = "pending" | "sent" | "failed";

export interface AppNotification {
  id: string;
  alert_id: string | null;
  channel: NotificationChannel;
  recipient: string | null;
  payload: Record<string, unknown> | null;
  status: NotificationStatus;
  error: string | null;
  created_at: string;
  sent_at: string | null;
}
