import { createFileRoute, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { fetchPrimaryRole, ROLE_HOME } from "@/lib/use-role";

export const Route = createFileRoute("/")({
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      throw redirect({ to: "/auth" });
    }
    // Already signed in — send straight to their dashboard
    const role = await fetchPrimaryRole(data.session.user.id);
    throw redirect({ to: (role ? ROLE_HOME[role] : "/auth") as "/rescue" });
  },
  // beforeLoad always redirects so this component never actually renders
  component: () => null,
});
