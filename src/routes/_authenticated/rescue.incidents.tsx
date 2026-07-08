import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  ALERT_STATUS_LABEL,
  ACTIVE_STATUSES,
  EMERGENCY_LEVEL_COLOR,
  type Boat,
  type Device,
  type Fisherman,
  type SOSAlertRow,
  type BMU,
} from "@/lib/marine-types";
import { supabase } from "@/integrations/supabase/client";
import { requireRole, type RouteContext } from "@/lib/route-guard";
import { Anchor, ArrowLeft, CheckCircle2, LogOut, Radio, Search, Waves } from "lucide-react";

export const Route = createFileRoute("/_authenticated/rescue/incidents")({
  ssr: false,
  beforeLoad: ({ context }) => requireRole(context as RouteContext, ["rescue_officer"]),
  head: () => ({
    meta: [{ title: "Incidents — Rescue Operations Center" }],
  }),
  component: IncidentsPage,
});

interface AlertJoined extends SOSAlertRow {
  fisherman?: Fisherman | null;
  boat?: Boat | null;
  device?: Device | null;
  bmu?: BMU | null;
}

function fmtDuration(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

function IncidentsPage() {
  const navigate = useNavigate();
  const [alerts, setAlerts] = useState<AlertJoined[]>([]);
  const [filter, setFilter] = useState<"active" | "resolved" | "all">("active");
  const [q, setQ] = useState("");
  const [now, setNow] = useState(Date.now());

  async function refresh() {
    const { data } = await supabase
      .from("sos_alerts")
      .select("*, fisherman:fisherman_id(*), boat:boat_id(*), device:device_id(*), bmu:bmu_id(*)")
      .order("started_at", { ascending: false })
      .limit(200);
    setAlerts((data as unknown as AlertJoined[]) ?? []);
  }

  useEffect(() => {
    refresh();
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    const ch = supabase
      .channel("incidents-stream")
      .on("postgres_changes", { event: "*", schema: "public", table: "sos_alerts" }, () =>
        refresh(),
      )
      .subscribe();
    return () => {
      window.clearInterval(tick);
      supabase.removeChannel(ch);
    };
  }, []);

  const visible = useMemo(() => {
    const list = alerts.filter((a) => {
      if (filter === "active" && !ACTIVE_STATUSES.includes(a.status)) return false;
      if (filter === "resolved" && ACTIVE_STATUSES.includes(a.status)) return false;
      if (q) {
        const hay = [
          a.fisherman?.full_name,
          a.boat?.name,
          a.boat?.registration_number,
          a.device?.device_id,
          a.bmu?.name,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q.toLowerCase())) return false;
      }
      return true;
    });
    return list.sort((a, b) => {
      const aNew = a.status === "new" && !a.acknowledged_at ? 0 : 1;
      const bNew = b.status === "new" && !b.acknowledged_at ? 0 : 1;
      if (aNew !== bNew) return aNew - bNew;
      return new Date(b.started_at).getTime() - new Date(a.started_at).getTime();
    });
  }, [alerts, filter, q]);

  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/auth" });
  }

  function openOnMap(id: string) {
    navigate({ to: "/rescue" as any, search: { selected: id } as any });
  }

  return (
    <div className="flex min-h-screen flex-col bg-ocean text-foam">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-foam/10 px-6 py-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate({ to: "/rescue" as any })}
            className="inline-flex items-center gap-1.5 rounded-lg border border-foam/15 px-3 py-1.5 text-xs hover:bg-foam/10"
            aria-label="Back to map"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Map
          </button>
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-tide/20 ring-1 ring-tide/30">
            <Anchor className="h-4 w-4 text-tide" />
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-[0.2em] text-foam/50">
              Coastal Command
            </div>
            <div className="text-sm font-semibold">Incidents</div>
          </div>
        </div>
        <button
          onClick={signOut}
          className="inline-flex items-center gap-1.5 rounded-lg border border-foam/15 px-3 py-1.5 text-xs hover:bg-foam/10"
        >
          <LogOut className="h-3.5 w-3.5" /> Sign out
        </button>
      </header>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3 border-b border-foam/10 px-6 py-3">
        <div className="inline-flex rounded-lg bg-foam/[0.04] p-0.5 text-[11px]">
          {(["active", "resolved", "all"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-md uppercase tracking-wider transition ${
                filter === f ? "bg-tide text-ocean" : "text-foam/60 hover:text-foam"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foam/40" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search boat, captain, device…"
            className="w-full rounded-lg border border-foam/10 bg-foam/[0.04] py-2 pl-9 pr-3 text-sm outline-none focus:border-tide/60"
          />
        </div>
        <div className="text-xs text-foam/40 tabular-nums">
          {visible.length} incident{visible.length !== 1 ? "s" : ""}
        </div>
      </div>

      {/* Incident list */}
      <div className="flex-1 overflow-y-auto divide-y divide-foam/5">
        {visible.length === 0 && (
          <div className="px-5 py-16 text-center text-sm text-foam/50">
            <Waves className="mx-auto mb-3 h-6 w-6 text-tide/60" />
            No incidents match.
          </div>
        )}
        {visible.map((a) => (
          <IncidentRow key={a.id} a={a} now={now} onClick={() => openOnMap(a.id)} />
        ))}
      </div>
    </div>
  );
}

function IncidentRow({ a, now, onClick }: { a: AlertJoined; now: number; onClick: () => void }) {
  const isActive = ACTIVE_STATUSES.includes(a.status);
  const isNew = a.status === "new" && !a.acknowledged_at;
  const startedMs = new Date(a.started_at).getTime();
  const gpsAgeS = a.last_ping_at
    ? Math.floor((now - new Date(a.last_ping_at).getTime()) / 1000)
    : null;
  const gpsFresh = gpsAgeS != null && gpsAgeS < 60;

  return (
    <button
      onClick={onClick}
      className={`relative block w-full px-6 py-4 text-left transition hover:bg-foam/[0.04] ${
        isNew ? "animate-[flash_1.2s_ease-in-out_infinite] bg-distress/10" : ""
      }`}
    >
      {isNew && <span className="absolute left-0 top-0 h-full w-1 bg-distress rounded-r" />}

      {/* Top row: status + level + time at sea */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 rounded-md border border-foam/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
              isActive ? "text-distress" : "text-tide"
            }`}
          >
            {isActive ? <Radio className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />}
            {ALERT_STATUS_LABEL[a.status]}
          </span>
          {a.emergency_level && (
            <span
              className={`rounded-md border border-foam/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${EMERGENCY_LEVEL_COLOR[a.emergency_level] ?? "text-foam"}`}
            >
              {a.emergency_level}
            </span>
          )}
        </div>
        <span className="text-[11px] tabular-nums text-foam/50">
          at sea {fmtDuration(now - startedMs)}
        </span>
      </div>

      {/* Boat name + registration */}
      <div className="mt-1.5 text-sm font-semibold text-foam">
        {a.boat?.name ?? "Unknown vessel"}
        {a.boat?.registration_number && (
          <span className="ml-1.5 text-[10px] font-mono text-foam/40">
            {a.boat.registration_number}
          </span>
        )}
      </div>

      {/* Captain + BMU */}
      <div className="text-xs text-foam/60">
        {a.fisherman?.full_name ?? "Unknown captain"} · {a.bmu?.name ?? "—"}
      </div>

      {/* GPS age + battery + "at sea" */}
      <div className="mt-1.5 flex items-center gap-4 font-mono text-[10px] text-foam/40 tabular-nums">
        <span className="inline-flex items-center gap-1">
          <span
            className={`h-1.5 w-1.5 rounded-full ${gpsFresh ? "bg-tide" : "bg-yellow-500/70"}`}
          />
          GPS {gpsAgeS != null ? `${gpsAgeS}s ago` : "—"}
        </span>
        {a.battery != null && (
          <span className={a.battery < 20 ? "text-distress" : ""}>🔋 {a.battery}%</span>
        )}
      </div>
    </button>
  );
}
