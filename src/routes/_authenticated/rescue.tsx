import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Map as LMap, Marker as LMarker } from "leaflet";
import {
  ALERT_STATUSES,
  ALERT_STATUS_LABEL,
  ACTIVE_STATUSES,
  type AlertStatus,
  type Boat,
  type Device,
  type Fisherman,
  type GpsLog,
  type SOSAlertRow,
  type BMU,
  type RescueOperation,
  EMERGENCY_LEVEL_COLOR,
} from "@/lib/marine-types";
import { supabase } from "@/integrations/supabase/client";
import { requireRole } from "@/lib/route-guard";
// Asset loaded at runtime to avoid build errors if the file is missing
const ALARM_URL = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (require("@/assets/sos-alarm.mp3.asset.json") as { url: string }).url;
  } catch {
    return "https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3";
  }
})();
import {
  Anchor,
  BellOff,
  BellRing,
  CheckCircle2,
  LogOut,
  Navigation,
  Radio,
  Search,
  Ship,
  Siren,
  Volume2,
  Waves,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/rescue")({
  ssr: false,
  beforeLoad: ({ context }) => requireRole(context as any, ["rescue_officer"]),
  head: () => ({
    meta: [
      { title: "Rescue Operations Center — MarineRescue" },
      { name: "description", content: "Live SOS incidents, real-time vessel tracking, rescue coordination." },
    ],
  }),
  component: RescueDashboard,
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

function RescueDashboard() {
  const navigate = useNavigate();
  const [alerts, setAlerts] = useState<AlertJoined[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"active" | "all" | "resolved">("active");
  const [muted, setMuted] = useState(false);
  const [audioReady, setAudioReady] = useState(false);
  const [dismissedBannerFor, setDismissedBannerFor] = useState<Set<string>>(new Set());
  const [stats, setStats] = useState({ boatsAtSea: 0, overdue: 0, devicesOnline: 0, activeRescues: 0 });
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const seenIdsRef = useRef<Set<string>>(new Set());

  async function refresh() {
    const { data } = await supabase
      .from("sos_alerts")
      .select("*, fisherman:fisherman_id(*), boat:boat_id(*), device:device_id(*), bmu:bmu_id(*)")
      .order("started_at", { ascending: false })
      .limit(200);
    setAlerts((data as unknown as AlertJoined[]) ?? []);
  }

  async function refreshStats() {
    const nowIso = new Date().toISOString();
    const cutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const [atSea, overdue, online, rescues] = await Promise.all([
      supabase.from("sea_trips").select("id", { count: "exact", head: true }).eq("status", "at_sea"),
      supabase.from("sea_trips").select("id", { count: "exact", head: true }).eq("status", "at_sea").lt("expected_return", nowIso),
      supabase.from("devices").select("id", { count: "exact", head: true }).gte("last_seen_at", cutoff),
      supabase.from("rescue_operations").select("id", { count: "exact", head: true }).is("ended_at", null),
    ]);
    setStats({
      boatsAtSea: atSea.count ?? 0,
      overdue: overdue.count ?? 0,
      devicesOnline: online.count ?? 0,
      activeRescues: rescues.count ?? 0,
    });
  }

  useEffect(() => {
    refresh();
    refreshStats();
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    const statsTick = window.setInterval(refreshStats, 30_000);
    const ch = supabase
      .channel("sos-stream")
      .on("postgres_changes", { event: "*", schema: "public", table: "sos_alerts" }, () => refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "sea_trips" }, refreshStats)
      .subscribe();
    return () => {
      window.clearInterval(tick);
      window.clearInterval(statsTick);
      supabase.removeChannel(ch);
    };
  }, []);

  // Track newly arrived NEW alerts to trigger alarm state
  useEffect(() => {
    for (const a of alerts) seenIdsRef.current.add(a.id);
  }, [alerts]);

  const unacknowledgedNew = useMemo(
    () => alerts.filter((a) => a.status === "new" && !a.acknowledged_at && !dismissedBannerFor.has(a.id)),
    [alerts, dismissedBannerFor],
  );
  const alarmActive = unacknowledgedNew.length > 0 && !muted;

  // Alarm playback
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    if (alarmActive && audioReady) {
      el.loop = true;
      el.volume = 1;
      el.play().catch(() => setAudioReady(false));
    } else {
      el.pause();
      el.currentTime = 0;
    }
  }, [alarmActive, audioReady]);

  async function enableAudio() {
    const el = audioRef.current;
    if (!el) return;
    try {
      el.muted = false;
      await el.play();
      el.pause();
      el.currentTime = 0;
      setAudioReady(true);
    } catch {
      setAudioReady(false);
    }
  }

  const visible = useMemo(() => {
    const list = alerts.filter((a) => {
      if (filter === "active" && !ACTIVE_STATUSES.includes(a.status)) return false;
      if (filter === "resolved" && ACTIVE_STATUSES.includes(a.status)) return false;
      if (q) {
        const hay = [a.fisherman?.full_name, a.boat?.name, a.boat?.registration_number, a.device?.device_id, a.bmu?.name]
          .filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(q.toLowerCase())) return false;
      }
      return true;
    });
    // New/unacknowledged first
    return list.sort((a, b) => {
      const aNew = a.status === "new" && !a.acknowledged_at ? 0 : 1;
      const bNew = b.status === "new" && !b.acknowledged_at ? 0 : 1;
      if (aNew !== bNew) return aNew - bNew;
      return new Date(b.started_at).getTime() - new Date(a.started_at).getTime();
    });
  }, [alerts, filter, q]);

  useEffect(() => {
    if (!selectedId && visible.length > 0) setSelectedId(visible[0].id);
    if (selectedId && !alerts.find((a) => a.id === selectedId)) setSelectedId(visible[0]?.id ?? null);
  }, [visible, alerts, selectedId]);

  const selected = useMemo(() => alerts.find((a) => a.id === selectedId) ?? null, [alerts, selectedId]);
  const activeCount = alerts.filter((a) => ACTIVE_STATUSES.includes(a.status)).length;

  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/auth" });
  }

  async function acknowledgeAll() {
    const ids = unacknowledgedNew.map((a) => a.id);
    if (ids.length === 0) return;
    await supabase.from("sos_alerts").update({ status: "acknowledged", acknowledged_at: new Date().toISOString() }).in("id", ids);
    refresh();
  }

  return (
    <div className="flex min-h-screen flex-col bg-ocean text-foam">
      <audio ref={audioRef} src={ALARM_URL} preload="auto" />

      {/* Full-screen emergency banner */}
      {unacknowledgedNew.length > 0 && (
        <EmergencyBanner
          count={unacknowledgedNew.length}
          topAlert={unacknowledgedNew[0]}
          muted={muted}
          audioReady={audioReady}
          onEnableAudio={enableAudio}
          onMute={() => setMuted(true)}
          onAcknowledge={acknowledgeAll}
          onView={() => {
            setSelectedId(unacknowledgedNew[0].id);
            setDismissedBannerFor(new Set(unacknowledgedNew.map((a) => a.id)));
          }}
        />
      )}

      <header className="flex items-center justify-between border-b border-foam/10 px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-tide/20 ring-1 ring-tide/30">
            <Anchor className="h-4 w-4 text-tide" />
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-[0.2em] text-foam/50">Coastal Command</div>
            <div className="text-sm font-semibold">Rescue Operations Center</div>
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs text-foam/60">
          <div className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 ${activeCount ? "bg-distress/15 text-distress" : "text-foam/60"}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${activeCount ? "animate-pulse bg-distress" : "bg-tide"}`} />
            {activeCount} active
          </div>
          {!audioReady && (
            <button onClick={enableAudio} className="inline-flex items-center gap-1.5 rounded-lg border border-yellow-500/40 bg-yellow-500/10 px-3 py-1.5 text-yellow-300 hover:bg-yellow-500/20">
              <Volume2 className="h-3.5 w-3.5" /> Enable alerts
            </button>
          )}
          <button
            onClick={() => setMuted((m) => !m)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-foam/15 px-3 py-1.5 hover:bg-foam/10"
          >
            {muted ? <BellOff className="h-3.5 w-3.5" /> : <BellRing className="h-3.5 w-3.5" />}
            {muted ? "Muted" : "Alarm on"}
          </button>
          <button onClick={signOut} className="inline-flex items-center gap-1.5 rounded-lg border border-foam/15 px-3 py-1.5 hover:bg-foam/10">
            <LogOut className="h-3.5 w-3.5" /> Sign out
          </button>
        </div>
      </header>

      {/* Overview stats bar */}
      <div className="grid grid-cols-2 gap-px border-b border-foam/10 bg-foam/[0.02] sm:grid-cols-4 lg:grid-cols-6">
        <StatCell label="Active SOS" value={activeCount} tone={activeCount ? "distress" : "muted"} icon={<Siren className="h-3.5 w-3.5" />} />
        <StatCell label="Active Rescues" value={stats.activeRescues} tone="tide" icon={<Radio className="h-3.5 w-3.5" />} />
        <StatCell label="Boats at Sea" value={stats.boatsAtSea} tone="foam" icon={<Ship className="h-3.5 w-3.5" />} />
        <StatCell label="Overdue" value={stats.overdue} tone={stats.overdue ? "distress" : "muted"} icon={<Waves className="h-3.5 w-3.5" />} />
        <StatCell label="Devices Online" value={stats.devicesOnline} tone="tide" icon={<Radio className="h-3.5 w-3.5" />} />
        <StatCell label="Resolved (24h)" value={alerts.filter((a) => (a.status === "resolved" || a.status === "closed") && Date.now() - new Date(a.started_at).getTime() < 86_400_000).length} tone="muted" icon={<CheckCircle2 className="h-3.5 w-3.5" />} />
      </div>

      <div className="grid flex-1 grid-cols-1 lg:grid-cols-[400px_1fr]">
        <aside className="border-r border-foam/10 bg-foam/[0.02]">
          <div className="border-b border-foam/10 p-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foam/40" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search boat, captain, device..."
                className="w-full rounded-lg border border-foam/10 bg-foam/[0.04] py-2 pl-9 pr-3 text-sm outline-none focus:border-tide/60"
              />
            </div>
            <div className="mt-3 inline-flex rounded-lg bg-foam/[0.04] p-0.5 text-[11px]">
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
          </div>

          <div className="divide-y divide-foam/5 max-h-[calc(100vh-260px)] overflow-y-auto">
            {visible.length === 0 && (
              <div className="px-5 py-10 text-center text-sm text-foam/50">
                <Waves className="mx-auto mb-3 h-6 w-6 text-tide/60" />
                No incidents match.
              </div>
            )}
            {visible.map((a) => <IncidentCard key={a.id} a={a} now={now} selected={selectedId === a.id} onClick={() => setSelectedId(a.id)} />)}
          </div>
        </aside>

        <main className="relative">
          {selected ? <AlertDetail alert={selected} now={now} onUpdated={refresh} /> : <EmptyMap />}
        </main>
      </div>
    </div>
  );
}

function StatCell({ label, value, tone, icon }: { label: string; value: number; tone: "distress" | "tide" | "foam" | "muted"; icon: React.ReactNode }) {
  const color = tone === "distress" ? "text-distress" : tone === "tide" ? "text-tide" : tone === "foam" ? "text-foam" : "text-foam/50";
  return (
    <div className="bg-ocean px-4 py-3">
      <div className={`inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider ${color}`}>{icon}{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${tone === "muted" ? "text-foam/70" : color}`}>{value}</div>
    </div>
  );
}

function IncidentCard({ a, now, selected, onClick }: { a: AlertJoined; now: number; selected: boolean; onClick: () => void }) {
  const startedMs = new Date(a.started_at).getTime();
  const isActive = ACTIVE_STATUSES.includes(a.status);
  const isNew = a.status === "new" && !a.acknowledged_at;
  const gpsAgeS = a.last_ping_at ? Math.floor((now - new Date(a.last_ping_at).getTime()) / 1000) : null;
  const gpsFresh = gpsAgeS != null && gpsAgeS < 60;
  return (
    <button
      onClick={onClick}
      className={`relative block w-full px-5 py-4 text-left transition hover:bg-foam/[0.04] ${
        selected ? (isActive ? "bg-distress/10" : "bg-foam/[0.05]") : ""
      } ${isNew ? "animate-[flash_1.2s_ease-in-out_infinite] bg-distress/15" : ""}`}
    >
      {isNew && <span className="absolute left-0 top-0 h-full w-1 bg-distress" />}
      <div className="flex items-center justify-between">
        <div className={`inline-flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider ${isActive ? "text-distress" : "text-tide"}`}>
          {isActive ? <Radio className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
          {ALERT_STATUS_LABEL[a.status]}
        </div>
        {a.emergency_level && (
          <span className={`rounded-md border border-foam/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${EMERGENCY_LEVEL_COLOR[a.emergency_level] ?? "text-foam"}`}>
            {a.emergency_level}
          </span>
        )}
      </div>
      <div className="mt-2 text-sm font-semibold text-foam">
        {a.boat?.name ?? "Unknown vessel"}
        {a.boat?.registration_number && <span className="ml-1.5 text-[10px] font-mono text-foam/40">{a.boat.registration_number}</span>}
      </div>
      <div className="text-xs text-foam/60">
        {a.fisherman?.full_name ?? "Unknown captain"} · {a.bmu?.name ?? "—"}
      </div>
      <div className="mt-1.5 flex items-center justify-between font-mono text-[10px] text-foam/40 tabular-nums">
        <span className="inline-flex items-center gap-1"><span className={`h-1.5 w-1.5 rounded-full ${gpsFresh ? "bg-tide" : "bg-yellow-500/70"}`} />GPS {gpsAgeS != null ? `${gpsAgeS}s` : "—"}</span>
        {a.battery != null && <span className={a.battery < 20 ? "text-distress" : ""}>🔋 {a.battery}%</span>}
        <span>at sea {fmtDuration(now - startedMs)}</span>
      </div>
    </button>
  );
}

function EmergencyBanner({
  count, topAlert, muted, audioReady, onEnableAudio, onMute, onAcknowledge, onView,
}: {
  count: number;
  topAlert: AlertJoined;
  muted: boolean;
  audioReady: boolean;
  onEnableAudio: () => void;
  onMute: () => void;
  onAcknowledge: () => void;
  onView: () => void;
}) {
  return (
    <div className="fixed inset-x-0 top-0 z-[1000] border-b-2 border-distress bg-distress/95 px-6 py-3 text-foam shadow-2xl animate-[flash_1s_ease-in-out_infinite]">
      <div className="mx-auto flex max-w-7xl items-center gap-4">
        <Siren className="h-6 w-6 animate-pulse" />
        <div className="flex-1">
          <div className="text-[11px] uppercase tracking-[0.2em] opacity-80">
            {count > 1 ? `${count} NEW SOS INCIDENTS` : "NEW SOS INCIDENT"}
          </div>
          <div className="text-base font-semibold">
            {topAlert.boat?.name ?? "Unknown vessel"} · {topAlert.fisherman?.full_name ?? "Unknown captain"}
            {topAlert.emergency_level && <span className="ml-2 rounded bg-black/25 px-1.5 py-0.5 text-[10px]">{topAlert.emergency_level}</span>}
          </div>
        </div>
        <button onClick={onView} className="rounded-lg bg-black/30 px-3 py-1.5 text-xs font-semibold hover:bg-black/40">View incident</button>
        <button onClick={onAcknowledge} className="rounded-lg bg-foam px-3 py-1.5 text-xs font-semibold text-distress hover:bg-foam/90">Acknowledge all</button>
        {!audioReady ? (
          <button onClick={onEnableAudio} className="rounded-lg border border-foam/40 px-3 py-1.5 text-xs hover:bg-foam/10">Enable sound</button>
        ) : (
          <button onClick={onMute} className={`rounded-lg border border-foam/40 px-3 py-1.5 text-xs hover:bg-foam/10 ${muted ? "opacity-50" : ""}`}>
            {muted ? "Muted" : "Mute alarm"}
          </button>
        )}
      </div>
    </div>
  );
}

function EmptyMap() {
  return (
    <div className="grid h-full min-h-[400px] place-items-center bg-ocean">
      <div className="text-center text-foam/50">
        <Waves className="mx-auto h-10 w-10 text-tide/50" />
        <div className="mt-4 text-sm">Awaiting distress signal…</div>
        <div className="mt-1 text-xs text-foam/40">Hardware devices push to <span className="font-mono">/api/public/ingest/sos</span></div>
      </div>
    </div>
  );
}

function AlertDetail({ alert, now, onUpdated }: { alert: AlertJoined; now: number; onUpdated: () => void }) {
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LMap | null>(null);
  const markerRef = useRef<LMarker | null>(null);
  const trailRef = useRef<import("leaflet").Polyline | null>(null);
  const lastIdRef = useRef<string | null>(null);
  const [latest, setLatest] = useState<GpsLog | null>(null);
  const [trail, setTrail] = useState<GpsLog[]>([]);
  const [followLive, setFollowLive] = useState(true);
  const [showTrail, setShowTrail] = useState(true);
  const [LRef, setLRef] = useState<typeof import("leaflet") | null>(null);
  const [rescueOp, setRescueOp] = useState<RescueOperation | null>(null);
  const [opBusy, setOpBusy] = useState(false);
  const [opNotes, setOpNotes] = useState("");
  const [opTeam, setOpTeam] = useState("");

  useEffect(() => {
    let cancelled = false;
    import("leaflet").then((mod) => {
      if (!cancelled) setLRef((mod.default ?? mod) as typeof import("leaflet"));
    });
    return () => { cancelled = true; };
  }, []);

  // Subscribe to latest GPS for this alert
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [{ data: logs }, { data: op }] = await Promise.all([
        supabase.from("gps_logs").select("*").eq("alert_id", alert.id)
          .order("recorded_at", { ascending: false }).limit(200),
        supabase.from("rescue_operations").select("*").eq("alert_id", alert.id)
          .order("started_at", { ascending: false }).limit(1),
      ]);
      if (!cancelled) {
        const allLogs = (logs ?? []) as GpsLog[];
        setLatest(allLogs[0] ?? null);
        setTrail([...allLogs].reverse());
        setRescueOp((op?.[0] as RescueOperation) ?? null);
        if (op?.[0]) { setOpNotes((op[0] as RescueOperation).notes ?? ""); setOpTeam((op[0] as RescueOperation).team_name ?? ""); }
      }
    }
    load();
    const ch = supabase
      .channel(`gps-${alert.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "gps_logs", filter: `alert_id=eq.${alert.id}` },
        (payload) => {
          const log = payload.new as GpsLog;
          setLatest(log);
          setTrail((prev) => [...prev, log]);
        },
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "rescue_operations", filter: `alert_id=eq.${alert.id}` },
        () => load(),
      )
      .subscribe();
    return () => { cancelled = true; supabase.removeChannel(ch); };
  }, [alert.id]);

  const live: { lat: number; lng: number; accuracy: number | null } | null =
    latest ? { lat: latest.lat, lng: latest.lng, accuracy: latest.accuracy }
    : alert.last_lat != null && alert.last_lng != null
    ? { lat: alert.last_lat, lng: alert.last_lng, accuracy: alert.last_accuracy ?? null }
    : null;

  // Init map for this alert
  useEffect(() => {
    if (!LRef || !mapEl.current) return;
    if (lastIdRef.current !== alert.id) {
      mapRef.current?.remove();
      mapRef.current = null;
      markerRef.current = null;
      trailRef.current = null;
    }
    if (!mapRef.current) {
      const center: [number, number] = live ? [live.lat, live.lng] : [-4.0435, 39.6682];
      const map = LRef.map(mapEl.current, { zoomControl: true, attributionControl: false }).setView(center, 14);
      LRef.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", { maxZoom: 19 }).addTo(map);
      mapRef.current = map;
      lastIdRef.current = alert.id;
    }
  }, [LRef, alert.id, live]);

  // GPS trail polyline
  useEffect(() => {
    if (!LRef || !mapRef.current) return;
    const pts: [number, number][] = trail.map((g) => [g.lat, g.lng]);
    if (trailRef.current) {
      trailRef.current.setLatLngs(pts);
    } else if (pts.length > 1) {
      trailRef.current = LRef.polyline(pts, {
        color: "#4dd9c0", weight: 2, opacity: 0.7, dashArray: "4 4",
      }).addTo(mapRef.current);
    }
    if (trailRef.current) {
      trailRef.current.setStyle({ opacity: showTrail ? 0.7 : 0 });
    }
  }, [LRef, trail, showTrail]);

  // Single blinking marker; no trail
  useEffect(() => {
    if (!LRef || !mapRef.current || !live) return;
    const pos: [number, number] = [live.lat, live.lng];
    if (!markerRef.current) {
      const icon = LRef.divIcon({
        className: "",
        html: `<div style="position:relative;width:28px;height:28px">
          <div style="position:absolute;inset:0;border-radius:9999px;background:rgba(225,53,69,0.4);animation:sos-pulse 1.2s ease-out infinite"></div>
          <div style="position:absolute;inset:0;border-radius:9999px;background:rgba(225,53,69,0.4);animation:sos-pulse 1.2s ease-out infinite;animation-delay:.6s"></div>
          <div style="position:absolute;inset:8px;border-radius:9999px;background:#e13545;box-shadow:0 0 0 3px rgba(255,255,255,0.95)"></div>
        </div>`,
        iconSize: [28, 28], iconAnchor: [14, 14],
      });
      markerRef.current = LRef.marker(pos, { icon }).addTo(mapRef.current);
    } else {
      markerRef.current.setLatLng(pos);
    }
    if (followLive && ACTIVE_STATUSES.includes(alert.status)) {
      mapRef.current.panTo(pos, { animate: true, duration: 0.6 });
    }
  }, [LRef, live?.lat, live?.lng, followLive, alert.status]);

  useEffect(() => () => {
    mapRef.current?.remove();
    mapRef.current = null;
    markerRef.current = null;
    trailRef.current = null;
    lastIdRef.current = null;
  }, []);

  async function createRescueOp() {
    setOpBusy(true);
    try {
      await supabase.from("rescue_operations").insert({
        alert_id: alert.id,
        team_name: opTeam || null,
        notes: opNotes || null,
        status: "assigned",
      });
      await supabase.from("sos_alerts").update({ status: "assigned" }).eq("id", alert.id);
      onUpdated();
    } finally { setOpBusy(false); }
  }

  async function closeRescueOp(opId: string) {
    setOpBusy(true);
    try {
      await supabase.from("rescue_operations").update({ ended_at: new Date().toISOString(), status: "resolved", notes: opNotes || null }).eq("id", opId);
      await supabase.from("sos_alerts").update({ status: "resolved", resolved_at: new Date().toISOString() }).eq("id", alert.id);
      onUpdated();
    } finally { setOpBusy(false); }
  }

  async function setStatus(next: AlertStatus) {
    const patch: Partial<SOSAlertRow> = { status: next };
    if (next === "acknowledged" && !alert.acknowledged_at) patch.acknowledged_at = new Date().toISOString();
    if ((next === "resolved" || next === "closed") && !alert.resolved_at) patch.resolved_at = new Date().toISOString();
    await supabase.from("sos_alerts").update(patch).eq("id", alert.id);
    onUpdated();
  }

  const isActive = ACTIVE_STATUSES.includes(alert.status);
  const gpsAgeS = latest ? Math.floor((now - new Date(latest.recorded_at).getTime()) / 1000) : null;

  return (
    <div className="relative h-full min-h-[500px]">
      <div ref={mapEl} className="absolute inset-0 bg-[#0a1929]" />
      <style>{`
        @keyframes sos-pulse {0%{transform:scale(0.6);opacity:1}100%{transform:scale(2.2);opacity:0}}
        @keyframes flash {0%,100%{opacity:1}50%{opacity:.55}}
        .leaflet-container{background:#0a1929;font-family:inherit}
        .leaflet-control-zoom a{background:rgba(15,40,60,0.9)!important;color:#eaf4f4!important;border-color:rgba(255,255,255,0.08)!important}
      `}</style>

      <div className="absolute left-4 top-4 z-[400] max-h-[calc(100vh-140px)] w-[360px] overflow-y-auto rounded-2xl border border-foam/10 bg-ocean/90 p-4 backdrop-blur-md">
        <div className="flex items-center justify-between">
          <div className={`inline-flex items-center gap-1.5 text-[11px] uppercase tracking-wider ${isActive ? "text-distress" : "text-tide"}`}>
            {isActive
              ? <><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-distress" /> {ALERT_STATUS_LABEL[alert.status]}</>
              : <><CheckCircle2 className="h-3.5 w-3.5" /> {ALERT_STATUS_LABEL[alert.status]}</>}
          </div>
          <div className="text-[11px] text-foam/50">{fmtDuration(now - new Date(alert.started_at).getTime())}</div>
        </div>

        {(alert.emergency_level || alert.battery != null) && (
          <div className="mt-2 flex items-center gap-2 text-[11px]">
            {alert.emergency_level && (
              <span className={`rounded-md border border-foam/15 px-2 py-0.5 font-semibold uppercase tracking-wider ${EMERGENCY_LEVEL_COLOR[alert.emergency_level] ?? "text-foam"}`}>
                {alert.emergency_level}
              </span>
            )}
            {alert.battery != null && (
              <span className={`rounded-md border border-foam/15 px-2 py-0.5 tabular-nums ${alert.battery < 20 ? "text-distress" : "text-foam/70"}`}>
                🔋 {alert.battery}%
              </span>
            )}
          </div>
        )}

        <div className="mt-3 text-lg font-semibold">{alert.boat?.name ?? "Unknown vessel"}</div>
        <div className="text-xs text-foam/60">
          {alert.boat?.registration_number && <span className="font-mono">{alert.boat.registration_number}</span>}
          {alert.boat?.boat_type && <span> · {alert.boat.boat_type}</span>}
        </div>

        <div className="mt-3 rounded-lg border border-foam/10 bg-foam/[0.03] p-3 text-xs">
          <div className="text-[10px] uppercase tracking-wider text-foam/40">Captain</div>
          <div className="mt-0.5 font-medium">{alert.fisherman?.full_name ?? "Unknown"}</div>
          {alert.fisherman?.phone && <div className="text-foam/60">{alert.fisherman.phone}</div>}
          {alert.fisherman?.national_id && <div className="text-foam/40 text-[10px]">ID {alert.fisherman.national_id}</div>}
        </div>

        <div className="mt-3 text-[11px] text-foam/40">
          BMU: {alert.bmu?.name ?? "—"} · Device: <span className="font-mono text-tide">{alert.device?.device_id}</span>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
          <Stat label="Latitude" value={live ? live.lat.toFixed(5) : "—"} />
          <Stat label="Longitude" value={live ? live.lng.toFixed(5) : "—"} />
          <Stat label="Accuracy" value={live?.accuracy != null ? `± ${Math.round(live.accuracy)} m` : "—"} />
          <Stat label="GPS age" value={gpsAgeS != null ? `${gpsAgeS}s` : "—"} />
        </div>

        {latest && (
          <div className="mt-3 flex items-center gap-2 text-[11px] text-foam/50 flex-wrap">
            <Navigation className="h-3 w-3 text-tide" />
            <span>Live tracking {followLive ? "on" : "off"}</span>
            <button onClick={() => setFollowLive((v) => !v)} className="rounded border border-foam/15 px-1.5 py-0.5 text-[10px] hover:bg-foam/10">
              {followLive ? "Unlock map" : "Follow"}
            </button>
            <button onClick={() => setShowTrail((v) => !v)} className="rounded border border-foam/15 px-1.5 py-0.5 text-[10px] hover:bg-foam/10">
              {showTrail ? "Hide trail" : "Show trail"} ({trail.length})
            </button>
          </div>
        )}

        {alert.fisherman?.emergency_contact_phone && (
          <div className="mt-3 rounded-lg border border-foam/10 bg-foam/[0.04] p-2 text-[11px] text-foam/70">
            <div className="uppercase tracking-wider text-foam/40">Emergency contact</div>
            <div>{alert.fisherman.emergency_contact_name ?? "—"} · {alert.fisherman.emergency_contact_phone}</div>
          </div>
        )}

        {/* Low battery warning */}
        {alert.battery != null && alert.battery < 20 && (
          <div className="mt-3 rounded-lg border border-distress/40 bg-distress/10 px-3 py-2 text-[11px] text-distress">
            ⚠️ Low battery: {alert.battery}% — device may stop transmitting soon.
          </div>
        )}

        {/* Rescue operation panel */}
        <div className="mt-4 border-t border-foam/10 pt-4">
          <div className="mb-2 text-[10px] uppercase tracking-wider text-foam/40">Rescue Operation</div>
          {rescueOp ? (
            <div className="space-y-2">
              <div className="rounded-lg border border-tide/30 bg-tide/5 px-3 py-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-tide">{rescueOp.team_name ?? "Team assigned"}</span>
                  <span className="text-foam/40">{rescueOp.ended_at ? "Closed" : "Active"}</span>
                </div>
                <div className="mt-1 text-foam/60">Started: {new Date(rescueOp.started_at).toLocaleString()}</div>
                {rescueOp.ended_at && <div className="text-foam/60">Ended: {new Date(rescueOp.ended_at).toLocaleString()}</div>}
              </div>
              {!rescueOp.ended_at && (
                <div className="space-y-1">
                  <textarea value={opNotes} onChange={(e) => setOpNotes(e.target.value)}
                    placeholder="Close-out notes…" rows={2}
                    className="w-full rounded-lg border border-foam/10 bg-ocean/60 px-2 py-1.5 text-xs text-foam outline-none focus:border-tide/60 resize-none" />
                  <button onClick={() => closeRescueOp(rescueOp.id)} disabled={opBusy}
                    className="w-full rounded-lg border border-tide/30 px-3 py-1.5 text-xs text-tide hover:bg-tide/10 disabled:opacity-60">
                    {opBusy ? "Saving…" : "Close operation & resolve alert"}
                  </button>
                </div>
              )}
            </div>
          ) : isActive ? (
            <div className="space-y-1">
              <input value={opTeam} onChange={(e) => setOpTeam(e.target.value)} placeholder="Team name (e.g. Coastguard Alpha)"
                className="w-full rounded-lg border border-foam/10 bg-ocean/60 px-2 py-1.5 text-xs text-foam outline-none focus:border-tide/60" />
              <textarea value={opNotes} onChange={(e) => setOpNotes(e.target.value)}
                placeholder="Notes / ETA…" rows={2}
                className="w-full rounded-lg border border-foam/10 bg-ocean/60 px-2 py-1.5 text-xs text-foam outline-none focus:border-tide/60 resize-none" />
              <button onClick={createRescueOp} disabled={opBusy}
                className="w-full rounded-lg bg-tide px-3 py-1.5 text-xs font-semibold text-ocean hover:bg-tide/90 disabled:opacity-60">
                {opBusy ? "Saving…" : "Assign rescue team"}
              </button>
            </div>
          ) : (
            <div className="text-xs text-foam/40">Alert resolved — no active rescue operation.</div>
          )}
        </div>

        <div className="mt-4">
          <div className="mb-1 text-[10px] uppercase tracking-wider text-foam/40">Rescue workflow</div>
          <select
            value={alert.status}
            onChange={(e) => setStatus(e.target.value as AlertStatus)}
            className="w-full rounded-lg border border-foam/10 bg-ocean/60 px-3 py-2 text-xs outline-none focus:border-tide/60"
          >
            {ALERT_STATUSES.map((s) => (
              <option key={s} value={s} className="bg-ocean">{ALERT_STATUS_LABEL[s]}</option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-foam/40">{label}</div>
      <div className="font-mono tabular-nums text-foam">{value}</div>
    </div>
  );
}
