import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Anchor, LifeBuoy, Loader2 } from "lucide-react";
import { fetchPrimaryRole, ROLE_HOME } from "@/lib/use-role";

async function goHome(navigate: ReturnType<typeof useNavigate>) {
  const { data } = await supabase.auth.getUser();
  if (!data.user) return;
  const role = await fetchPrimaryRole(data.user.id);
  navigate({ to: (role ? ROLE_HOME[role] : "/fisherman") as "/rescue" });
}

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — MarineRescue" },
      { name: "description", content: "Sign in to the MarineRescue command center." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) goHome(navigate);
    });
  }, [navigate]);

  async function handleEmail(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: window.location.origin,
            data: { full_name: fullName },
          },
        });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      await goHome(navigate);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogle() {
    setErr(null);
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: window.location.origin + "/auth",
        },
      });
      if (error) throw error;
      // browser will redirect — no further action needed here
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-ocean text-foam grid place-items-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-2 mb-6">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-foam/10 ring-1 ring-foam/15">
            <LifeBuoy className="h-4 w-4 text-distress" />
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-[0.2em] text-foam/50">SEAGUARD</div>
            <div className="text-sm font-semibold">Marine Rescue Network</div>
          </div>
        </div>

        <div className="mt-6 rounded-2xl border border-foam/10 bg-foam/[0.04] p-6">
          <div className="flex items-center gap-2">
            <Anchor className="h-4 w-4 text-tide" />
            <h1 className="text-xl font-semibold">
              {mode === "signin" ? "Sign in" : "Create account"}
            </h1>
          </div>
          <p className="mt-1 text-sm text-foam/60">
            Access the BMU registration and rescue command dashboards.
          </p>

          <button
            onClick={handleGoogle}
            disabled={loading}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg border border-foam/15 bg-foam/[0.06] px-4 py-2.5 text-sm font-medium text-foam transition hover:bg-foam/10 disabled:opacity-60"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4">
              <path
                fill="#fff"
                d="M21.35 11.1H12v3.2h5.35c-.23 1.24-1.4 3.65-5.35 3.65-3.22 0-5.85-2.66-5.85-5.95s2.63-5.95 5.85-5.95c1.83 0 3.05.78 3.75 1.45l2.55-2.45C16.9 3.5 14.7 2.5 12 2.5 6.75 2.5 2.5 6.75 2.5 12s4.25 9.5 9.5 9.5c5.48 0 9.1-3.85 9.1-9.27 0-.62-.07-1.1-.25-1.13Z"
              />
            </svg>
            Continue with Google
          </button>

          <div className="my-5 flex items-center gap-3 text-[11px] uppercase tracking-wider text-foam/40">
            <div className="h-px flex-1 bg-foam/10" /> or email{" "}
            <div className="h-px flex-1 bg-foam/10" />
          </div>

          <form onSubmit={handleEmail} className="space-y-3">
            {mode === "signup" && (
              <Field
                label="Full name"
                value={fullName}
                onChange={setFullName}
                type="text"
                required
              />
            )}
            <Field label="Email" value={email} onChange={setEmail} type="email" required />
            <Field
              label="Password"
              value={password}
              onChange={setPassword}
              type="password"
              required
            />
            {err && (
              <div className="rounded-lg bg-distress/15 px-3 py-2 text-xs text-distress">{err}</div>
            )}
            <button
              type="submit"
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-tide py-2.5 text-sm font-semibold text-ocean transition hover:bg-tide/90 disabled:opacity-60"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              {mode === "signin" ? "Sign in" : "Create account"}
            </button>
          </form>

          <button
            onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
            className="mt-4 w-full text-center text-xs text-foam/60 hover:text-foam"
          >
            {mode === "signin" ? "No account yet? Create one" : "Already registered? Sign in"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-[11px] uppercase tracking-wider text-foam/50">{label}</span>
      <input
        type={type}
        value={value}
        required={required}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg border border-foam/10 bg-ocean/40 px-3 py-2 text-sm text-foam outline-none focus:border-tide/60"
      />
    </label>
  );
}
