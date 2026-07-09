import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  ALERT_STATUS_LABEL,
  ALERT_STATUSES,
  ACTIVE_STATUSES,
  EMERGENCY_LEVEL_COLOR,
  type Boat,
  type Device,
  type Fisherman,
  type SOSAlertRow,
  type BMU,
  type RescueOperation,
} from "@/lib/marine-types";
import { supabase } from "@/integrations/supabase/client";
import { requireRole, type RouteContext } from "@/lib/route-guard";
import {
  Anchor,
  ArrowLeft,
  CheckCircle2,
  LogOut,
  Radio,
  Search,
  Waves,
  Users,
  BellRing,
  Siren,
} from "lucide-react";

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
  rescue_op?: RescueOperation | null;
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
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());

  async function refresh() {
    const { data } = await supabase
      .from("sos_alerts")
      .select("*, fisherman:fisherman_id(*), boat:boat_id(*), device:device_id(*), bmu:bmu_id(*)")
      .order("started_at", { ascending: false })
      .limit(200);

    const rows = (data as unknown as AlertJoined[]) ?? [];

    const ids = rows.map((r) => r.id).filter(Boolean);
    if (ids.length === 0) {
      setAlerts(rows.map((r) => ({ ...r, rescue_op: null })));
      return;
    }

    const { data: ops } = await supabase
      .from("rescue_operations")
      .select("id, alert_id, team_name, status, started_at, ended_at")
      .in("alert_id", ids)
      .order("started_at", { ascending: false });

    const latestByAlert = new Map<string, RescueOperation>();
    for (const op of ops ?? []) {
      const existing = latestByAlert.get(op.alert_id);
      if (!existing) latestByAlert.set(op.alert_id, op as RescueOperation);
    }

    setAlerts(rows.map((r) => ({ ...r, rescue_op: latestByAlert.get(r.id) ?? null })));
  }

  useEffect(() => {
    refresh();
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    const ch = supabase
      .channel("incidents-stream")
      .on("postgres_changes", { event: "*", schema: "public", table: "sos_alerts" }, () =>
        refresh(),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "rescue_operations" }, () =>
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
        const teamPart = a.rescue_op?.team_name ?? "";
        const hay = [
          a.fisherman?.full_name,
          a.boat?.name,
          a.boat?.registration_number,
          a.device?.device_id,
          a.bmu?.name,
          teamPart,
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

  async function acknowledge(a: AlertJoined) {
    if (busyIds.has(a.id)) return;
    setBusyIds((prev) => new Set(prev).add(a.id));
    try {
      await supabase
        .from("sos_alerts")
        .update({ status: "acknowledged", acknowledged_at: new Date().toISOString() })
        .eq("id", a.id);
      await refresh();
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(a.id);
        return next;
      });
    }
  }

  async function assign(a: AlertJoined) {
    if (busyIds.has(a.id)) return;
    const team = prompt("Team name (e.g. Coastguard Alpha):");
    if (!team) return;
    setBusyIds((prev) => new Set(prev).add(a.id));
    try {
      await supabase.from("rescue_operations").insert({
        alert_id: a.id,
        team_name: team,
        status: "assigned",
      });
      await supabase.from("sos_alerts").update({ status: "assigned" }).eq("id", a.id);
      await refresh();
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(a.id);
        return next;
      });
    }
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
            placeholder="Search boat, captain, device, team…"
            className="w-full rounded-lg border border-foam/10 bg-foam/[0.04] py-2 pl-9 pr-3 text-sm outline-none focus:border-tide/60"
          />
        </div>
        <div className="text-xs text-foam/40 tabular-nums">
          {visible.length} incident{visible.length !== 1 ? "s" : ""}
        </div>
      </div>

      {/* Desktop table header */}
      <div className="hidden md:grid md:grid-cols-12 gap-3 px-6 py-2 text-[10px] uppercase tracking-wider text-foam/40 border-b border-foam/10 bg-foam/[0.02]">
        <div className="col-span-3">Incident</div>
        <div className="col-span-2">Emergency</div>
        <div className="col-span-2">Assigned Team</div>
        <div className="col-span-1 text-right">GPS</div>
        <div className="col-span-1 text-right">Battery</div>
        <div className="col-span-1 text-right">At Sea</div>
        <div className="col-span-2 text-right">Actions</div>
      </div>

      {/* Incident list */}
      <div className="flex-1 overflow-y-auto">
        {visible.length === 0 && (
          <div className="px-5 py-16 text-center text-sm text-foam/50">
            <Waves className="mx-auto mb-3 h-6 w-6 text-tide/60" />
            No incidents match.
          </div>
        )}
        {visible.map((a) => (
          <IncidentRow
            key={a.id}
            a={a}
            now={now}
            busy={busyIds.has(a.id)}
            onAcknowledge={() => acknowledge(a)}
            onAssign={() => assign(a)}
            onViewMap={() => openOnMap(a.id)}
          />
        ))}
      </div>
    </div>
  );
}

function IncidentRow({
  a,
  now,
  busy,
  onAcknowledge,
  onAssign,
  onViewMap,
}: {
  a: AlertJoined;
  now: number;
  busy: boolean;
  onAcknowledge: () => void;
  onAssign: () => void;
  onViewMap: () => void;
}) {
  const isActive = ACTIVE_STATUSES.includes(a.status);
  const isNew = a.status === "new" && !a.acknowledged_at;
  const startedMs = new Date(a.started_at).getTime();
  const gpsAgeS = a.last_ping_at
    ? Math.floor((now - new Date(a.last_ping_at).getTime()) / 1000)
    : null;
  const gpsFresh = gpsAgeS != null && gpsAgeS < 60;
  const gpsStale = gpsAgeS != null && gpsAgeS > 300;
  const hasOp = !!a.rescue_op;

  return (
    <div
      className={`relative grid grid-cols-1 md:grid-cols-12 gap-2 md:gap-3 px-4 md:px-6 py-3 md:py-4 border-b border-foam/5 transition hover:bg-foam/[0.04] ${
        isNew ? "bg-distress/[0.06]" : ""
      }`}
    >
      {isNew && (
        <span className="absolute left-0 top-0 h-full w-1 bg-distress rounded-r md:hidden" />
      )}

      {/* Incident info */}
      <div className="md:col-span-3 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className={`inline-flex items-center gap-1 rounded-md border border-foam/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
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
              {a.emergency_level === "HIGH" ? <Siren className="h-3 w-3 inline mr-1" /> : null}
              {a.emergency_level}
            </span>
          )}
        </div>
        <div className="mt-1 text-sm font-semibold text-foam truncate">
          {a.boat?.name ?? "Unknown vessel"}
          {a.boat?.registration_number && (
            <span className="ml-1.5 text-[10px] font-mono text-foam/40">
              {a.boat.registration_number}
            </span>
          )}
        </div>
        <div className="text-[11px] text-foam/60 truncate">
          {a.fisherman?.full_name ?? "Unknown captain"} · {a.bmu?.name ?? "—"}
        </div>
      </div>

      {/* Emergency level detail */}
      <div className="md:col-span-2 flex md:items-center">
        <div className="text-xs text-foam/70 md:mt-0 mt-1">
          {a.emergency_level ? (
            <span className="font-semibold">{a.emergency_level} priority</span>
          ) : (
            <span className="text-foam/40">Standard</span>
          )}
          {a.battery != null && (
            <div className="text-[10px] font-mono text-foam/50 mt-0.5">
              🔋 {a.battery}%{a.battery < 20 && <span className="text-distress ml-1">LOW</span>}
            </div>
          )}
        </div>
      </div>

      {/* Assigned team */}
      <div className="md:col-span-2 flex md:items-center">
        <div className="text-xs md:mt-0 mt-1">
          {hasOp ? (
            <div className="flex items-center gap-1.5 text-tide">
              <Users className="h-3 w-3" />
              <span className="font-medium truncate">{a.rescue_op!.team_name}</span>
            </div>
          ) : (
            <span className="text-foam/40 italic">Unassigned</span>
          )}
        </div>
      </div>

      {/* GPS age */}
      <div className="md:col-span-1 flex md:items-center md:justify-end">
        <div className="flex items-center gap-1.5 md:justify-end">
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              gpsFresh ? "bg-tide" : gpsStale ? "bg-distress" : "bg-yellow-500/70"
            }`}
          />
          <span className="text-[11px] font-mono tabular-nums text-foam/60">
            {gpsAgeS != null ? `${gpsAgeS}s` : "—"}
          </span>
        </div>
      </div>

      {/* Battery */}
      <div className="hidden md:flex md:col-span-1 items-center justify-end">
        <span
          className={`text-xs font-mono tabular-nums ${(a.battery ?? 100) < 20 ? "text-distress" : "text-foam/60"}`}
        >
          {a.battery != null ? `${a.battery}%` : "—"}
        </span>
      </div>

      {/* Duration */}
      <div className="hidden md:flex md:col-span-1 items-center justify-end">
        <span className="text-[11px] tabular-nums text-foam/50">
          {fmtDuration(now - startedMs)}
        </span>
      </div>

      {/* Actions */}
      <div className="md:col-span-2 flex items-center gap-2 md:justify-end mt-2 md:mt-0">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onViewMap();
          }}
          className="rounded-md border border-foam/15 px-2.5 py-1.5 text-[11px] font-medium text-foam hover:bg-foam/10 transition"
        >
          Map
        </button>
        {isActive && (
          <>
            {!a.acknowledged_at && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onAcknowledge();
                }}
                disabled={busy}
                className="rounded-md border border-yellow-500/40 bg-yellow-500/10 px-2.5 py-1.5 text-[11px] font-semibold text-yellow-300 hover:bg-yellow-500/20 disabled:opacity-60 transition"
              >
                <BellRing className="h-3 w-3 inline mr-1" />
                Ack
              </button>
            )}
            {!hasOp && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onAssign();
                }}
                disabled={busy}
                className="rounded-md bg-tide px-2.5 py-1.5 text-[11px] font-semibold text-ocean hover:bg-tide/90 disabled:opacity-60 transition"
              >
                <Users className="h-3 w-3 inline mr-1" />
                Assign
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
