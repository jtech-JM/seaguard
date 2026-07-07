import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { fetchPrimaryRole, ROLE_HOME } from "@/lib/use-role";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    // Resolve the user's primary role and expose it to child routes
    const role = await fetchPrimaryRole(data.user.id);
    return { user: data.user, role };
  },
  component: () => <Outlet />,
});
