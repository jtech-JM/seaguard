/**
 * Shared beforeLoad helper for role-protected routes.
 *
 * Usage in a route file:
 *   beforeLoad: ({ context }) => requireRole(context, ["admin"])
 */
import { redirect } from "@tanstack/react-router";
import type { AppRole } from "@/lib/use-role";
import { ROLE_HOME } from "@/lib/use-role";

interface RouteContext {
  role: AppRole | null;
}

export function requireRole(
  context: RouteContext,
  allowed: AppRole[],
) {
  const { role } = context;

  // Not logged in — should not happen (parent already checked), but guard anyway
  if (!role) throw redirect({ to: "/auth" });

  // Wrong role — send them to their own dashboard
  if (!allowed.includes(role)) {
    throw redirect({ to: ROLE_HOME[role] as "/rescue" });
  }
}
