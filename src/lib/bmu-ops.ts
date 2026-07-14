import { supabase } from "@/integrations/supabase/client";
import type { AppRole } from "@/lib/use-role";
import type { TripStatus } from "@/lib/marine-types";

interface RpcResult<T> {
  data: T | null;
  error: Error | null;
}

export async function manageFisherman(input: {
  action: "create" | "update" | "delete";
  id?: string;
  fullName?: string | null;
  phone?: string | null;
  nationalId?: string | null;
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
  photoUrl?: string | null;
  active?: boolean;
  bmuId?: string | null;
}) {
  return (supabase.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<RpcResult<string>>)(
    "manage_bmu_fisherman",
    {
      p_action: input.action,
      p_id: input.id ?? null,
      p_full_name: input.fullName ?? null,
      p_phone: input.phone ?? null,
      p_national_id: input.nationalId ?? null,
      p_emergency_contact_name: input.emergencyContactName ?? null,
      p_emergency_contact_phone: input.emergencyContactPhone ?? null,
      p_photo_url: input.photoUrl ?? null,
      p_active: input.active ?? true,
      p_bmu_id: input.bmuId ?? null,
    },
  );
}

export async function linkProfile(profileId: string, fishermanId: string) {
  return (supabase.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<RpcResult<null>>)(
    "link_profile_to_fisherman",
    { p_profile_id: profileId, p_fisherman_id: fishermanId },
  );
}

export async function unlinkProfile(profileId: string) {
  return (supabase.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<RpcResult<null>>)(
    "unlink_profile_from_fisherman",
    { p_profile_id: profileId },
  );
}

export async function manageBoat(input: {
  action: "create" | "update" | "delete";
  id?: string;
  name?: string | null;
  registrationNumber?: string | null;
  boatType?: string | null;
  ownerFishermanId?: string | null;
  bmuId?: string | null;
}) {
  return (supabase.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<RpcResult<string>>)(
    "manage_bmu_boat",
    {
      p_action: input.action,
      p_id: input.id ?? null,
      p_name: input.name ?? null,
      p_registration_number: input.registrationNumber ?? null,
      p_boat_type: input.boatType ?? null,
      p_owner_fisherman_id: input.ownerFishermanId ?? null,
      p_bmu_id: input.bmuId ?? null,
    },
  );
}

export async function manageDevice(input: {
  action: "create" | "update" | "delete";
  id?: string;
  deviceId?: string | null;
  boatId?: string | null;
  hardwareType?: string | null;
  active?: boolean;
  reason?: string | null;
}) {
  return (supabase.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<RpcResult<{ id: string; device_secret: string | null }>>)(
    "manage_bmu_device",
    {
      p_action: input.action,
      p_id: input.id ?? null,
      p_device_id: input.deviceId ?? null,
      p_boat_id: input.boatId ?? null,
      p_hardware_type: input.hardwareType ?? null,
      p_active: input.active ?? true,
      p_reason: input.reason ?? null,
    },
  );
}

export async function manageCrewMember(input: {
  action: "add" | "remove";
  tripId: string;
  fishermanId?: string;
  role?: string | null;
  crewId?: string;
}) {
  return (supabase.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<RpcResult<null>>)(
    "manage_trip_crew_member",
    {
      p_action: input.action,
      p_trip_id: input.tripId,
      p_fisherman_id: input.fishermanId ?? null,
      p_role: input.role ?? null,
      p_crew_id: input.crewId ?? null,
    },
  );
}

export async function transitionTrip(tripId: string, targetStatus: TripStatus, reason?: string | null) {
  return (supabase.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<RpcResult<null>>)(
    "bmu_transition_trip",
    { p_trip_id: tripId, p_target_status: targetStatus, p_reason: reason ?? null },
  );
}
