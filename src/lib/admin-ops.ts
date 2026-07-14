import { supabase } from "@/integrations/supabase/client";
import type { AppRole } from "@/lib/use-role";

export async function setUserRole(userId: string, role: AppRole, enabled: boolean) {
  return (supabase.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<unknown>)(
    "set_user_role",
    {
      _user_id: userId,
      _role: role,
      _enabled: enabled,
    },
  );
}

export async function linkProfileToFisherman(profileId: string, fishermanId: string | null) {
  return (supabase.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<unknown>)(
    "admin_link_profile_to_fisherman",
    {
      p_profile_id: profileId,
      p_fisherman_id: fishermanId,
    },
  );
}
