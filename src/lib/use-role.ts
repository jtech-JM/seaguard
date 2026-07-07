import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

// ── Four roles, one dashboard each ───────────────────────────────
export type AppRole =
  | "admin"
  | "bmu_officer"
  | "rescue_officer"
  | "fisherman";

export const ROLE_HOME: Record<AppRole, string> = {
  admin:          "/admin",
  bmu_officer:    "/bmu",
  rescue_officer: "/rescue",
  fisherman:      "/fisherman",
};

// Which roles are allowed on each route (used in beforeLoad guards)
export const ROUTE_ROLES: Record<string, AppRole[]> = {
  "/admin":     ["admin"],
  "/bmu":       ["bmu_officer"],
  "/rescue":    ["rescue_officer"],
  "/fisherman": ["fisherman"],
};

const ROLE_PRIORITY: AppRole[] = [
  "admin",
  "rescue_officer",
  "bmu_officer",
  "fisherman",
];

export function pickPrimary(roles: AppRole[]): AppRole | null {
  for (const r of ROLE_PRIORITY) if (roles.includes(r)) return r;
  return roles[0] ?? null;
}

export async function fetchPrimaryRole(userId: string): Promise<AppRole | null> {
  const { data } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  const roles = (data ?? []).map((r: { role: string }) => r.role as AppRole);
  return pickPrimary(roles);
}

// Roles that are staff (non-fisherman) — used to filter profile picker
export const STAFF_ROLES: AppRole[] = ["admin", "bmu_officer", "rescue_officer"];

export function useCurrentRole() {
  const [role, setRole] = useState<AppRole | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!data.user) {
        if (!cancelled) { setRole(null); setLoading(false); }
        return;
      }
      const r = await fetchPrimaryRole(data.user.id);
      if (!cancelled) { setRole(r); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, []);
  return { role, loading };
}
