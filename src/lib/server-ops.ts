import { supabase } from "@/integrations/supabase/client";
import type { AppRole } from "@/lib/use-role";

interface RpcResult<T> {
  data: T | null;
  error: Error | null;
}

export async function setUserRole(userId: string, role: AppRole, enabled: boolean) {
  return (supabase.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<RpcResult<null>>)(
    "set_user_role",
    {
      _user_id: userId,
      _role: role,
      _enabled: enabled,
    },
  );
}

export async function createTripRequest(input: {
  boatId: string | null;
  deviceId: string | null;
  destination: string | null;
  fishingArea: string | null;
  expectedReturn: string | null;
  notes: string | null;
  crewIds: string[];
}) {
  return (supabase.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<RpcResult<string>>)(
    "create_fisherman_trip_request",
    {
      p_boat_id: input.boatId,
      p_device_id: input.deviceId,
      p_destination: input.destination,
      p_fishing_area: input.fishingArea,
      p_expected_return: input.expectedReturn ? new Date(input.expectedReturn).toISOString() : null,
      p_notes: input.notes,
      p_crew_ids: input.crewIds,
    },
  );
}

export async function checkInTrip(tripId: string) {
  return (supabase.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<RpcResult<null>>)(
    "check_in_fisherman_trip",
    { p_trip_id: tripId },
  );
}

export async function triggerSos(input: { deviceId: string; lat: number; lng: number; accuracy: number; notes: string | null }) {
  return (supabase.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<RpcResult<string>>)(
    "trigger_fisherman_sos",
    {
      p_device_id: input.deviceId,
      p_lat: input.lat,
      p_lng: input.lng,
      p_accuracy: input.accuracy,
      p_notes: input.notes,
    },
  );
}

export async function cancelSos(alertId: string, reason: string) {
  return (supabase.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<RpcResult<null>>)(
    "cancel_fisherman_sos",
    {
      p_alert_id: alertId,
      p_reason: reason,
    },
  );
}

export async function cancelTripRequest(tripId: string) {
  return (supabase.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<RpcResult<null>>)(
    "cancel_fisherman_trip_request",
    { p_trip_id: tripId },
  );
}

export async function logAuditEvent(action: string, entityType: string, entityId: string | null, details: Record<string, unknown>) {
  return (supabase.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<RpcResult<null>>)(
    "log_audit_event",
    {
      p_action: action,
      p_entity_type: entityType,
      p_entity_id: entityId,
      p_details: details,
    },
  );
}
