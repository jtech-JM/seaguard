import { supabase } from "@/integrations/supabase/client";
import type { AlertStatus } from "@/lib/marine-types";

interface RpcResult<T> {
  data: T | null;
  error: Error | null;
}

export async function assignRescueOperation(input: { alertId: string; teamName: string | null; notes: string | null }) {
  return (supabase.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<RpcResult<null>>)(
    "assign_rescue_operation",
    {
      p_alert_id: input.alertId,
      p_team_name: input.teamName,
      p_notes: input.notes,
    },
  );
}

export async function closeRescueOperation(input: { alertId: string; opId: string; notes: string | null }) {
  return (supabase.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<RpcResult<null>>)(
    "close_rescue_operation",
    {
      p_alert_id: input.alertId,
      p_op_id: input.opId,
      p_notes: input.notes,
    },
  );
}

export async function updateAlertStatus(input: { alertId: string; nextStatus: AlertStatus; notes: string | null }) {
  return (supabase.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<RpcResult<null>>)(
    "update_alert_status",
    {
      p_alert_id: input.alertId,
      p_next_status: input.nextStatus,
      p_notes: input.notes,
    },
  );
}
