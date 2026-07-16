import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Anchor, Eye, EyeOff } from "lucide-react";
import { fetchPrimaryRole, ROLE_HOME } from "@/lib/use-role";
import { ThemeToggleButton } from "@/lib/theme";

async function goHome(navigate: ReturnType<typeof useNavigate>) {
  const { data } = await supabase.auth.getUser();
  if (!data.user) return;
  const role = await fetchPrimaryRole(data.user.id);
  navigate({ to: (role ? ROLE_HOME[role] : "/fisherman") as any });
}

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — SEAGUARD" },
      { name: "description", content: "Sign in to the SEAGUARD Marine Rescue Network." },
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
  const [showPassword, setShowPassword] = useState(false);
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
        options: { redirectTo: window.location.origin + "/auth" },
      });
      if (error) throw error;
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#f5f5f5] dark:bg-[#0f1923] flex flex-col items-center justify-center px-4 py-10">
      {/* Header */}
      <div className="w-full max-w-md flex items-center gap-3 mb-6">
        <CompassRose />
        <div>
          <div className="text-[15px] font-bold tracking-widest text-[#1a6b6b] dark:text-[#4ecdc4] uppercase">
            SEAGUARD
          </div>
          <div className="text-[13px] text-gray-500 dark:text-gray-400">Marine Rescue Network</div>
        </div>
        <div className="ml-auto">
          <ThemeToggleButton />
        </div>
      </div>

      {/* Card */}
      <div className="w-full max-w-md rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#1a2632] shadow-sm px-8 py-8">
        {/* Title */}
        <div className="flex items-center gap-2 mb-1">
          <Anchor className="h-5 w-5 text-[#1a6b6b] dark:text-[#4ecdc4]" />
          <h1 className="text-[22px] font-semibold text-gray-800 dark:text-white">
            {mode === "signin" ? "Sign in" : "Create account"}
          </h1>
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
          Access the rescue command dashboards and BMU registration portal.
        </p>

        {/* Google */}
        <button
          onClick={handleGoogle}
          disabled={loading}
          className="flex w-full items-center justify-center gap-3 rounded-xl border border-gray-300 dark:border-white/15 bg-white dark:bg-white/5 px-4 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-200 shadow-sm transition hover:bg-gray-50 dark:hover:bg-white/10 disabled:opacity-60"
        >
          <GoogleIcon />
          {mode === "signin" ? "Sign in with Google" : "Sign up with Google"}
        </button>

        {/* Divider */}
        <div className="my-5 flex items-center gap-3 text-[11px] uppercase tracking-widest text-gray-400">
          <div className="h-px flex-1 bg-gray-200 dark:bg-white/10" />
          or email
          <div className="h-px flex-1 bg-gray-200 dark:bg-white/10" />
        </div>

        {/* Form */}
        <form onSubmit={handleEmail} className="space-y-4">
          {mode === "signup" && (
            <FloatingField
              id="fullName"
              label="Full name"
              type="text"
              value={fullName}
              onChange={setFullName}
              required
            />
          )}
          <FloatingField
            id="email"
            label="Email"
            type="email"
            value={email}
            onChange={setEmail}
            required
          />
          <FloatingField
            id="password"
            label="Password"
            type={showPassword ? "text" : "password"}
            value={password}
            onChange={setPassword}
            required
            suffix={
              <button
                type="button"
                tabIndex={-1}
                onClick={() => setShowPassword((v) => !v)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            }
          />

          {err && (
            <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-500/30 px-3 py-2 text-xs text-red-600 dark:text-red-400">
              {err}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#1a6b6b] hover:bg-[#155858] dark:bg-[#1a8080] dark:hover:bg-[#1a9090] py-3 text-sm font-semibold text-white transition disabled:opacity-60 mt-2"
          >
            {loading && (
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
            )}
            {mode === "signin" ? "Sign In" : "Create account"}
          </button>
        </form>

        {/* Toggle mode */}
        <p className="mt-5 text-center text-sm text-gray-500 dark:text-gray-400">
          {mode === "signin" ? (
            <>
              No account yet?{" "}
              <button
                onClick={() => { setMode("signup"); setErr(null); }}
                className="font-semibold text-[#1a6b6b] dark:text-[#4ecdc4] hover:underline"
              >
                Sign up now
              </button>
            </>
          ) : (
            <>
              Already registered?{" "}
              <button
                onClick={() => { setMode("signin"); setErr(null); }}
                className="font-semibold text-[#1a6b6b] dark:text-[#4ecdc4] hover:underline"
              >
                Sign in
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  );
}

// ── Floating-label input ──────────────────────────────────────────────────────
function FloatingField({
  id,
  label,
  type,
  value,
  onChange,
  required,
  suffix,
}: {
  id: string;
  label: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  suffix?: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label
        htmlFor={id}
        className="block text-[11px] font-semibold uppercase tracking-widest text-gray-500 dark:text-gray-400"
      >
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={type}
          value={value}
          required={required}
          placeholder={label}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 px-4 py-2.5 text-sm text-gray-800 dark:text-white placeholder:text-gray-300 dark:placeholder:text-white/20 outline-none focus:border-[#1a6b6b] dark:focus:border-[#4ecdc4] focus:ring-2 focus:ring-[#1a6b6b]/15 dark:focus:ring-[#4ecdc4]/15 transition pr-10"
        />
        {suffix && (
          <div className="absolute inset-y-0 right-3 flex items-center">{suffix}</div>
        )}
      </div>
    </div>
  );
}

// ── Compass rose SVG logo ─────────────────────────────────────────────────────
function CompassRose() {
  return (
    <svg
      width="40"
      height="40"
      viewBox="0 0 40 40"
      fill="none"
      className="shrink-0"
      aria-hidden="true"
    >
      <circle cx="20" cy="20" r="19" stroke="#1a6b6b" strokeWidth="1.5" className="dark:stroke-[#4ecdc4]" />
      {/* Cardinal points */}
      <polygon points="20,4 22.5,18 20,16 17.5,18" fill="#1a6b6b" className="dark:fill-[#4ecdc4]" />
      <polygon points="20,36 22.5,22 20,24 17.5,22" fill="#1a6b6b" fillOpacity="0.4" className="dark:fill-[#4ecdc4]" />
      <polygon points="4,20 18,17.5 16,20 18,22.5" fill="#1a6b6b" fillOpacity="0.4" className="dark:fill-[#4ecdc4]" />
      <polygon points="36,20 22,17.5 24,20 22,22.5" fill="#1a6b6b" className="dark:fill-[#4ecdc4]" />
      {/* Center dot */}
      <circle cx="20" cy="20" r="2.5" fill="#1a6b6b" className="dark:fill-[#4ecdc4]" />
    </svg>
  );
}

// ── Google "G" icon ───────────────────────────────────────────────────────────
function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" aria-hidden="true">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  );
}
