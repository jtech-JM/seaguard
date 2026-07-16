import { createFileRoute, useNavigate, Outlet, useLocation } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
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
import { canTransitionAlertStatus } from "@/lib/alert-status";
import { requireRole, type RouteContext } from "@/lib/route-guard";
import { useTheme } from "@/lib/theme";
import { assignRescueOperation, closeRescueOperation, updateAlertStatus } from "@/lib/rescue-ops";
import alarmUrl from "@/assets/mixkit-retro-game-emergency-alarm-1000.wav?url";
const ALARM_URL = alarmUrl;
import {
  Anchor,
  BellOff,
  BellRing,
  CheckCircle2,
  ClipboardList,
  ExternalLink,
  MapPin,
  Moon,
  Navigation,
  Radio,
  RouteIcon,
  Satellite,
  Ship,
  Siren,
  Sun,
  Volume2,
  Waves,
  X,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/rescue")({
  ssr: false,
  beforeLoad: ({ context }) => requireRole(context as RouteContext, ["rescue_officer"]),
  head: () => ({
    meta: [
      { title: "Rescue Operations Center — MarineRescue" },
      {
        name: "description",
        content: "Live SOS incidents, real-time vessel tracking, rescue coordination.",
      },
    ],
  }),
  component: RescueRouteComponent,
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

function RescueRouteComponent() {
  const location = useLocation();
  if (location.pathname !== "/rescue") {
    return <Outlet />;
  }
  return <RescueDashboard />;
}

function RescueDashboard() {
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();
  const search = Route.useSearch() as { selected?: string };
  const [alerts, setAlerts] = useState<AlertJoined[]>([]);
  const [bmus, setBMUs] = useState<BMU[]>([]);
  const [selectedBmuId, setSelectedBmuId] = useState<string>("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [muted, setMuted] = useState(false);
  const [audioReady, setAudioReady] = useState(false);
  const [dismissedBannerFor, setDismissedBannerFor] = useState<Set<string>>(new Set());
  const [userProfile, setUserProfile] = useState<{ name: string; avatarUrl: string | null }>({
    name: "",
    avatarUrl: null,
  });
  const [stats, setStats] = useState({
    boatsAtSea: 0,
    overdue: 0,
    devicesOnline: 0,
    activeRescues: 0,
  });
  const [satelliteView, setSatelliteView] = useState(false);
  const [drawMode, setDrawMode] = useState(false);
  const [routePoints, setRoutePoints] = useState<{ lat: number; lng: number }[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const seenIdsRef = useRef<Set<string>>(new Set());

  // Map refs — single instance at root level
  const mapElRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LMap | null>(null);
  const LRef = useRef<typeof import("leaflet") | null>(null);
  const markersRef = useRef<Map<string, LMarker>>(new Map());
  const trailsRef = useRef<Map<string, import("leaflet").Polyline>>(new Map());
  const tileLayerRef = useRef<import("leaflet").TileLayer | null>(null);
  const routeLineRef = useRef<import("leaflet").Polyline | null>(null);
  const routeMarkersRef = useRef<import("leaflet").Marker[]>([]);

  // Per-alert GPS data for the detail panel
  const [detailLatest, setDetailLatest] = useState<GpsLog | null>(null);
  const [detailTrail, setDetailTrail] = useState<GpsLog[]>([]);
  const [detailFollowLive, setDetailFollowLive] = useState(true);
  const [detailShowTrail, setDetailShowTrail] = useState(true);
  const [detailRescueOp, setDetailRescueOp] = useState<RescueOperation | null>(null);
  const [detailOpBusy, setDetailOpBusy] = useState(false);
  const [detailOpNotes, setDetailOpNotes] = useState("");
  const [detailOpTeam, setDetailOpTeam] = useState("");

  const filteredAlerts = useMemo(() => {
    if (!selectedBmuId) return alerts;
    return alerts.filter((a) => a.bmu_id === selectedBmuId);
  }, [alerts, selectedBmuId]);

  async function refresh() {
    const { data } = await supabase
      .from("sos_alerts")
      .select("*, fisherman:fisherman_id(*), boat:boat_id(*), device:device_id(*), bmu:bmu_id(*)")
      .order("started_at", { ascending: false })
      .limit(200);
    setAlerts((data as unknown as AlertJoined[]) ?? []);
  }

  async function loadBMUs() {
    const { data } = await supabase.from("bmus").select("*").order("name");
    setBMUs((data as BMU[]) ?? []);
  }

  async function refreshStats(bmuId?: string) {
    const nowIso = new Date().toISOString();
    const cutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();

    let tripsQ = supabase
      .from("sea_trips")
      .select("id", { count: "exact", head: true })
      .eq("status", "at_sea");
    let overdueQ = supabase
      .from("sea_trips")
      .select("id", { count: "exact", head: true })
      .eq("status", "at_sea")
      .lt("expected_return", nowIso);
    let onlineQ = supabase
      .from("devices")
      .select("id, boats!inner(bmu_id)", { count: "exact", head: true })
      .gte("last_seen_at", cutoff);
    let rescuesQ = supabase
      .from("rescue_operations")
      .select("id, alert:alert_id!inner(bmu_id)", { count: "exact", head: true })
      .is("ended_at", null);

    if (bmuId) {
      tripsQ = tripsQ.eq("bmu_id", bmuId);
      overdueQ = overdueQ.eq("bmu_id", bmuId);
      onlineQ = onlineQ.eq("boats.bmu_id", bmuId);
      rescuesQ = rescuesQ.eq("alert.bmu_id", bmuId);
    }

    const [atSea, overdue, online, rescues] = await Promise.all([
      tripsQ,
      overdueQ,
      onlineQ,
      rescuesQ,
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
    loadBMUs();
    // Fetch the signed-in user's profile for the avatar
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) return;
      const meta = data.user.user_metadata ?? {};
      setUserProfile({
        name: (meta.full_name ?? meta.name ?? data.user.email ?? "") as string,
        avatarUrl: (meta.avatar_url ?? meta.picture ?? null) as string | null,
      });
    });
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    const ch = supabase
      .channel("sos-stream")
      .on("postgres_changes", { event: "*", schema: "public", table: "sos_alerts" }, () =>
        refresh(),
      )
      .subscribe();
    return () => {
      window.clearInterval(tick);
      supabase.removeChannel(ch);
    };
  }, []);

  useEffect(() => {
    refreshStats(selectedBmuId);
    const statsTick = window.setInterval(() => refreshStats(selectedBmuId), 30_000);
    const ch = supabase
      .channel("trips-stream")
      .on("postgres_changes", { event: "*", schema: "public", table: "sea_trips" }, () =>
        refreshStats(selectedBmuId),
      )
      .subscribe();
    return () => {
      window.clearInterval(statsTick);
      supabase.removeChannel(ch);
    };
  }, [selectedBmuId]);

  // Handle ?selected= URL param on mount
  useEffect(() => {
    if (search.selected) setSelectedId(search.selected);
  }, [search.selected]);

  // Track newly arrived NEW alerts to trigger alarm state
  useEffect(() => {
    for (const a of alerts) seenIdsRef.current.add(a.id);
  }, [alerts]);

  const unacknowledgedNew = useMemo(
    () =>
      alerts.filter(
        (a) => a.status === "new" && !a.acknowledged_at && !dismissedBannerFor.has(a.id),
      ),
    [alerts, dismissedBannerFor],
  );
  const alarmActive = unacknowledgedNew.length > 0 && !muted;

  // Try to unlock audio on first load (works if user has interacted with the page before)
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    el.muted = true;
    el.play()
      .then(() => {
        el.pause();
        el.currentTime = 0;
        el.muted = false;
        setAudioReady(true); // browser allowed it — alarm will auto-play
      })
      .catch(() => {
        el.muted = false;
        // Browser blocked autoplay — officer must click "Enable alerts" first
        setAudioReady(false);
      });
  }, []);

  // Alarm playback — fires whenever alarmActive or audioReady changes
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    if (alarmActive) {
      el.loop = true;
      el.volume = 1;
      el.muted = false;
      el.play().catch(() => {
        // Auto-play blocked — mark as not ready so the button shows
        setAudioReady(false);
      });
    } else {
      el.pause();
      el.currentTime = 0;
    }
  }, [alarmActive]);

  async function enableAudio() {
    const el = audioRef.current;
    if (!el) return;
    try {
      el.muted = false;
      await el.play();
      el.pause();
      el.currentTime = 0;
      setAudioReady(true);
      // If alarm should be active right now, start it immediately
      if (alarmActive) {
        el.loop = true;
        el.volume = 1;
        el.play().catch(() => {});
      }
    } catch {
      setAudioReady(false);
    }
  }

  const activeCount = alerts.filter((a) => ACTIVE_STATUSES.includes(a.status)).length;
  const selected = useMemo(
    () => alerts.find((a) => a.id === selectedId) ?? null,
    [alerts, selectedId],
  );

  async function acknowledgeAll() {
    const ids = unacknowledgedNew.map((a) => a.id);
    if (ids.length === 0) return;
    const results = await Promise.all(
      ids.map((id) =>
        updateAlertStatus({
          alertId: id,
          nextStatus: "acknowledged",
          notes: "Acknowledged from rescue dashboard",
        }),
      ),
    );
    const failed = results.find((result) => result.error);
    if (failed?.error) {
      window.alert(failed.error.message);
    }
    refresh();
  }

  function toggleSatelliteView() {
    const L = LRef.current;
    const map = mapRef.current;
    if (!L || !map) return;
    const next = !satelliteView;
    if (tileLayerRef.current) {
      map.removeLayer(tileLayerRef.current);
    }
    const url = next
      ? "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
      : "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
    tileLayerRef.current = L.tileLayer(url, { maxZoom: 19 }).addTo(map);
    setSatelliteView(next);
  }

  function toggleDrawMode() {
    setDrawMode((prev) => !prev);
    if (drawMode) {
      clearRoute();
    }
  }

  const handleMapClickForRoute = useCallback(
    (e: { latlng: { lat: number; lng: number } }) => {
      if (!drawMode) return;
      const L = LRef.current;
      const map = mapRef.current;
      if (!L || !map) return;
      const pt = e.latlng;
      const marker = L.marker([pt.lat, pt.lng], {
        icon: L.divIcon({
          className: "",
          html: `<div style="width:10px;height:10px;border-radius:50%;background:#0891b2;border:2px solid white;box-shadow:0 0 4px rgba(0,0,0,0.4)"></div>`,
          iconSize: [10, 10],
          iconAnchor: [5, 5],
        }),
      }).addTo(map);
      routeMarkersRef.current = [...routeMarkersRef.current, marker];
      setRoutePoints((prev) => [...prev, { lat: pt.lat, lng: pt.lng }]);
    },
    [drawMode],
  );

  function clearRoute() {
    routeMarkersRef.current.forEach((m) => m.remove());
    routeMarkersRef.current = [];
    if (routeLineRef.current) {
      routeLineRef.current.remove();
      routeLineRef.current = null;
    }
    setRoutePoints([]);
  }

  function finishRoute() {
    setDrawMode(false);
  }

  function zoomToLocation() {
    const map = mapRef.current;
    const a = selected;
    if (!map || !a) return;
    const lat = detailLatest?.lat ?? a.last_lat;
    const lng = detailLatest?.lng ?? a.last_lng;
    if (lat != null && lng != null) {
      map.flyTo([lat, lng], 15, { animate: true, duration: 0.8 });
    }
  }

  // ── Leaflet: load library once ───────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    import("leaflet").then((mod) => {
      if (!cancelled) LRef.current = (mod.default ?? mod) as typeof import("leaflet");
      initMap();
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function initMap() {
    const L = LRef.current;
    if (!L || !mapElRef.current || mapRef.current) return;
    const map = L.map(mapElRef.current, { zoomControl: true, attributionControl: false }).setView(
      [-4.0435, 39.6682],
      7,
    );
    tileLayerRef.current = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
    }).addTo(map);
    mapRef.current = map;
  }

  // ── Rebuild all markers when alerts change ───────────────────────────────
  useEffect(() => {
    const L = LRef.current;
    const map = mapRef.current;
    if (!L || !map) return;

    const currentIds = new Set(filteredAlerts.map((a) => a.id));

    // Remove stale markers
    markersRef.current.forEach((marker, id) => {
      if (!currentIds.has(id)) {
        marker.remove();
        markersRef.current.delete(id);
      }
    });

    // Upsert markers for all alerts with GPS coords
    for (const a of filteredAlerts) {
      if (a.last_lat == null || a.last_lng == null) continue;
      const pos: [number, number] = [a.last_lat, a.last_lng];
      const isActive = ACTIVE_STATUSES.includes(a.status);
      const isSelected = a.id === selectedId;

      const icon = buildMarkerIcon(L, a, isActive, isSelected);

      const existing = markersRef.current.get(a.id);
      if (existing) {
        existing.setLatLng(pos);
        existing.setIcon(icon);
      } else {
        const marker = L.marker(pos, { icon }).addTo(map);
        marker.on("click", () => setSelectedId((prev) => (prev === a.id ? null : a.id)));
        markersRef.current.set(a.id, marker);
      }
    }
  }, [filteredAlerts, selectedId]);

  // ── Pan to selected alert ────────────────────────────────────────────────
  useEffect(() => {
    if (!selectedId || !mapRef.current) return;
    const a = filteredAlerts.find((al) => al.id === selectedId);
    if (a?.last_lat != null && a?.last_lng != null) {
      mapRef.current.panTo([a.last_lat, a.last_lng], { animate: true, duration: 0.6 });
    }
  }, [selectedId, filteredAlerts]);

  // ── Load detail panel data when selectedId changes ───────────────────────
  useEffect(() => {
    if (!selectedId) {
      setDetailLatest(null);
      setDetailTrail([]);
      setDetailRescueOp(null);
      return;
    }
    let cancelled = false;
    let ch: ReturnType<typeof supabase.channel> | null = null;

    async function loadDetail() {
      const [{ data: logs }, { data: op }] = await Promise.all([
        supabase
          .from("gps_logs")
          .select("*")
          .eq("alert_id", selectedId!)
          .order("recorded_at", { ascending: false })
          .limit(200),
        supabase
          .from("rescue_operations")
          .select("*")
          .eq("alert_id", selectedId!)
          .order("started_at", { ascending: false })
          .limit(1),
      ]);
      if (!cancelled) {
        const allLogs = (logs ?? []) as GpsLog[];
        setDetailLatest(allLogs[0] ?? null);
        setDetailTrail([...allLogs].reverse());
        const opRow = (op?.[0] as RescueOperation) ?? null;
        setDetailRescueOp(opRow);
        if (opRow) {
          setDetailOpNotes(opRow.notes ?? "");
          setDetailOpTeam(opRow.team_name ?? "");
        } else {
          setDetailOpNotes("");
          setDetailOpTeam("");
        }
      }
    }
    loadDetail();

    ch = supabase
      .channel(`gps-detail-${selectedId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "gps_logs",
          filter: `alert_id=eq.${selectedId}`,
        },
        (payload) => {
          const log = payload.new as GpsLog;
          setDetailLatest(log);
          setDetailTrail((prev) => [...prev, log]);
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "rescue_operations",
          filter: `alert_id=eq.${selectedId}`,
        },
        () => loadDetail(),
      )
      .subscribe();

    return () => {
      cancelled = true;
      if (ch) supabase.removeChannel(ch);
    };
  }, [selectedId]);

  // ── GPS trail polyline for selected alert ────────────────────────────────
  useEffect(() => {
    const L = LRef.current;
    const map = mapRef.current;
    if (!L || !map || !selectedId) return;

    // Remove trails for non-selected alerts
    trailsRef.current.forEach((line, id) => {
      if (id !== selectedId) {
        line.remove();
        trailsRef.current.delete(id);
      }
    });

    const pts: [number, number][] = detailTrail.map((g) => [g.lat, g.lng]);
    const existing = trailsRef.current.get(selectedId);
    if (existing) {
      existing.setLatLngs(pts);
      existing.setStyle({ opacity: detailShowTrail ? 0.8 : 0 });
    } else if (pts.length > 1) {
      const line = L.polyline(pts, {
        color: "#0891b2",
        weight: 3,
        opacity: detailShowTrail ? 0.8 : 0,
        dashArray: "6 4",
      }).addTo(map);
      trailsRef.current.set(selectedId, line);
    }
  }, [selectedId, detailTrail, detailShowTrail]);

  // ── Map click handler for route drawing ──────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (drawMode) {
      map.on("click", handleMapClickForRoute);
      map.getContainer().style.cursor = "crosshair";
    } else {
      map.off("click", handleMapClickForRoute);
      map.getContainer().style.cursor = "";
    }
    return () => {
      map.off("click", handleMapClickForRoute);
      map.getContainer().style.cursor = "";
    };
  }, [drawMode, handleMapClickForRoute]);

  // ── Rescue route polyline ─────────────────────────────────────────────────
  useEffect(() => {
    const L = LRef.current;
    const map = mapRef.current;
    if (!L || !map) return;
    if (routeLineRef.current) {
      routeLineRef.current.remove();
      routeLineRef.current = null;
    }
    if (routePoints.length > 1) {
      const latlngs: [number, number][] = routePoints.map((p) => [p.lat, p.lng]);
      routeLineRef.current = L.polyline(latlngs, {
        color: "#f59e0b",
        weight: 4,
        opacity: 0.9,
        dashArray: "8 6",
      }).addTo(map);
    }
  }, [routePoints]);

  // ── Cleanup route on unmount ──────────────────────────────────────────────
  useEffect(
    () => () => {
      routeMarkersRef.current.forEach((m) => m.remove());
      routeMarkersRef.current = [];
      if (routeLineRef.current) {
        routeLineRef.current.remove();
        routeLineRef.current = null;
      }
      if (tileLayerRef.current && mapRef.current) {
        mapRef.current.removeLayer(tileLayerRef.current);
        tileLayerRef.current = null;
      }
    },
    [],
  );

  // ── Follow live GPS for selected alert ──────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !detailLatest || !detailFollowLive || !selectedId) return;
    const a = filteredAlerts.find((al) => al.id === selectedId);
    if (!a || !ACTIVE_STATUSES.includes(a.status)) return;
    map.panTo([detailLatest.lat, detailLatest.lng], { animate: true, duration: 0.6 });
  }, [detailLatest, detailFollowLive, selectedId, filteredAlerts]);

  // ── Cleanup map on unmount ───────────────────────────────────────────────
  useEffect(
    () => () => {
      mapRef.current?.remove();
      mapRef.current = null;
      markersRef.current.clear();
      trailsRef.current.clear();
    },
    [],
  );

  // ── Rescue operation helpers ─────────────────────────────────────────────
  async function createRescueOp() {
    if (!selectedId) return;
    const alert = filteredAlerts.find((item) => item.id === selectedId);
    if (!alert || !canTransitionAlertStatus(alert.status, "assigned")) return;
    setDetailOpBusy(true);
    try {
      const { error } = await assignRescueOperation({
        alertId: selectedId,
        teamName: detailOpTeam || null,
        notes: detailOpNotes || null,
      });
      if (error) {
        window.alert(error.message);
      }
      refresh();
    } finally {
      setDetailOpBusy(false);
    }
  }

  async function closeRescueOp(opId: string) {
    if (!selectedId) return;
    const alert = filteredAlerts.find((item) => item.id === selectedId);
    if (!alert || !canTransitionAlertStatus(alert.status, "resolved")) return;
    setDetailOpBusy(true);
    try {
      const { error } = await closeRescueOperation({
        alertId: selectedId,
        opId,
        notes: detailOpNotes || null,
      });
      if (error) {
        window.alert(error.message);
      }
      refresh();
    } finally {
      setDetailOpBusy(false);
    }
  }

  async function setStatus(next: AlertStatus) {
    if (!selectedId) return;
    const a = filteredAlerts.find((al) => al.id === selectedId);
    if (!a || !canTransitionAlertStatus(a.status, next)) return;
    const { error } = await updateAlertStatus({
      alertId: selectedId,
      nextStatus: next,
      notes: detailOpNotes || null,
    });
    if (error) {
      alert(error.message);
    }

    refresh();
  }

  const live: { lat: number; lng: number; accuracy: number | null } | null = selected
    ? detailLatest
      ? { lat: detailLatest.lat, lng: detailLatest.lng, accuracy: detailLatest.accuracy }
      : selected.last_lat != null && selected.last_lng != null
        ? {
            lat: selected.last_lat,
            lng: selected.last_lng,
            accuracy: selected.last_accuracy ?? null,
          }
        : null
    : null;
  const gpsAgeS = detailLatest
    ? Math.floor((now - new Date(detailLatest.recorded_at).getTime()) / 1000)
    : null;
  const panelOpen = selectedId !== null && selected !== null;
  const selectedIsActive = selected ? ACTIVE_STATUSES.includes(selected.status) : false;

  return (
    <div className="flex min-h-screen flex-col bg-ocean text-foam">
      <audio ref={audioRef} src={ALARM_URL} preload="auto" />
      <style>{`
        @keyframes sos-pulse {0%{transform:scale(0.6);opacity:1}100%{transform:scale(2.2);opacity:0}}
        @keyframes flash {0%,100%{opacity:1}50%{opacity:.55}}
        .leaflet-container{background:#e5e5e5;font-family:inherit}
        .leaflet-control-zoom a{background:rgba(255,255,255,0.95)!important;color:#1a1a1a!important;border-color:rgba(0,0,0,0.08)!important}
      `}</style>

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

      {/* Header */}
      <header className="flex items-center justify-between border-b border-foam/10 px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-tide/20 ring-1 ring-tide/30">
            <Anchor className="h-4 w-4 text-tide" />
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-[0.2em] text-foam/50">
              Coastal Command
            </div>
            <div className="text-sm font-semibold">Rescue Operations Center</div>
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs text-foam/60">
          {/* Theme toggle — clean icon button */}
          <button
            onClick={() => setTheme(theme === "light" ? "dark" : "light")}
            aria-label="Toggle theme"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-foam/15 bg-foam/5 text-foam/70 transition hover:bg-foam/15"
          >
            {theme === "light" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
          </button>

          {/* User avatar */}
          <div className="flex items-center gap-2">
            {userProfile.avatarUrl ? (
              <img
                src={userProfile.avatarUrl}
                alt={userProfile.name}
                className="h-8 w-8 rounded-full object-cover ring-2 ring-tide/30"
              />
            ) : (
              <div className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-tide/20 ring-2 ring-tide/30 text-[11px] font-bold text-tide uppercase select-none">
                {userProfile.name ? userProfile.name.charAt(0) : "?"}
              </div>
            )}
          </div>

          {/* BMU filter */}
          {bmus.length > 0 && (
            <select
              value={selectedBmuId}
              onChange={(e) => setSelectedBmuId(e.target.value)}
              className="rounded-lg border border-foam/15 bg-ocean/90 px-3 py-1.5 text-xs text-foam outline-none focus:border-tide/60"
            >
              <option value="" className="bg-ocean">
                All Beach Units (BMUs)
              </option>
              {bmus.map((b) => (
                <option key={b.id} value={b.id} className="bg-ocean">
                  {b.name}
                </option>
              ))}
            </select>
          )}

          {/* Active count pill */}
          <div
            className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 ${activeCount ? "bg-distress/15 text-distress" : "text-foam/60"}`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${activeCount ? "animate-pulse bg-distress" : "bg-tide"}`}
            />
            {activeCount} active
          </div>

          {/* System alarm badge — clicking toggles mute; shows enable prompt if audio locked */}
          {!audioReady ? (
            <button
              onClick={enableAudio}
              className="inline-flex animate-pulse items-center gap-2 rounded-lg border border-yellow-500/50 bg-yellow-500/15 px-3 py-1.5 text-xs font-semibold text-yellow-300 hover:bg-yellow-500/25 transition"
            >
              <Volume2 className="h-3.5 w-3.5" />
              ENABLE ALARM SOUND
              <ExternalLink className="h-3 w-3 opacity-60" />
            </button>
          ) : (
            <button
              onClick={() => setMuted((m) => !m)}
              className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                muted
                  ? "border-foam/15 bg-foam/5 text-foam/50 hover:bg-foam/10"
                  : alarmActive
                    ? "animate-pulse border-distress/50 bg-distress/15 text-distress hover:bg-distress/25"
                    : "border-tide/30 bg-tide/10 text-tide hover:bg-tide/20"
              }`}
            >
              {muted ? (
                <BellOff className="h-3.5 w-3.5" />
              ) : (
                <BellRing className={`h-3.5 w-3.5 ${alarmActive ? "animate-bounce" : ""}`} />
              )}
              SYSTEM ALARM:{" "}
              {muted ? "DISABLED" : alarmActive ? "ACTIVE" : "ENABLED (SILENT)"}
            </button>
          )}
        </div>
      </header>

      {/* Stats bar */}
      <div className="grid grid-cols-2 gap-px border-b border-foam/10 bg-foam/[0.02] sm:grid-cols-4 lg:grid-cols-6">
        <StatCell
          label="Active SOS"
          value={activeCount}
          tone={activeCount ? "distress" : "muted"}
          icon={<Siren className="h-3.5 w-3.5" />}
        />
        <StatCell
          label="Active Rescues"
          value={stats.activeRescues}
          tone="tide"
          icon={<Radio className="h-3.5 w-3.5" />}
        />
        <StatCell
          label="Boats at Sea"
          value={stats.boatsAtSea}
          tone="foam"
          icon={<Ship className="h-3.5 w-3.5" />}
        />
        <StatCell
          label="Overdue"
          value={stats.overdue}
          tone={stats.overdue ? "distress" : "muted"}
          icon={<Waves className="h-3.5 w-3.5" />}
        />
        <StatCell
          label="Devices Online"
          value={stats.devicesOnline}
          tone="tide"
          icon={<Radio className="h-3.5 w-3.5" />}
        />
        <StatCell
          label="Resolved (24h)"
          value={
            filteredAlerts.filter(
              (a) =>
                (a.status === "resolved" || a.status === "closed") &&
                Date.now() - new Date(a.started_at).getTime() < 86_400_000,
            ).length
          }
          tone="muted"
          icon={<CheckCircle2 className="h-3.5 w-3.5" />}
        />
      </div>

      {/* Body: full-screen map */}
      <div className="relative flex-1">
        {/* Map fills 100% */}
        <div ref={mapElRef} className="absolute inset-0 bg-[#e5e5e5]" />

        {/* Bottom-left pill: Incidents button */}
        <div className="absolute bottom-6 left-6 z-[500]">
          <button
            onClick={() => navigate({ to: "/rescue/incidents" as any })}
            className="inline-flex items-center gap-2 rounded-full border border-foam/20 bg-ocean/90 px-4 py-2.5 text-sm font-semibold text-foam shadow-lg backdrop-blur-md hover:bg-foam/10 transition"
          >
            <ClipboardList className="h-4 w-4 text-tide" />
            Incidents
            {activeCount > 0 && (
              <span className="ml-0.5 rounded-full bg-distress px-1.5 py-0.5 text-[10px] font-bold text-white">
                {activeCount}
              </span>
            )}
          </button>
        </div>

        {/* Top-right map controls */}
        <div className="absolute top-4 right-4 z-[500] flex flex-col gap-2">
          <button
            onClick={toggleSatelliteView}
            className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold shadow-lg backdrop-blur-md transition ${
              satelliteView
                ? "border-tide/40 bg-tide/20 text-tide"
                : "border-foam/20 bg-ocean/90 text-foam hover:bg-foam/10"
            }`}
          >
            <Satellite className="h-4 w-4" />
            {satelliteView ? "Standard" : "Satellite"}
          </button>
          <button
            onClick={toggleDrawMode}
            className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold shadow-lg backdrop-blur-md transition ${
              drawMode
                ? "border-distress/40 bg-distress/20 text-distress"
                : "border-foam/20 bg-ocean/90 text-foam hover:bg-foam/10"
            }`}
          >
            <RouteIcon className="h-4 w-4" />
            {drawMode ? "Finish Route" : "Draw Route"}
          </button>
          {drawMode && (
            <button
              onClick={clearRoute}
              className="inline-flex items-center gap-2 rounded-lg border border-yellow-500/40 bg-yellow-500/10 px-3 py-2 text-xs font-semibold text-yellow-300 shadow-lg backdrop-blur-md hover:bg-yellow-500/20 transition"
            >
              Clear
            </button>
          )}
        </div>

        {/* Draw mode indicator */}
        {drawMode && (
          <div className="absolute top-4 left-1/2 z-[500] -translate-x-1/2">
            <div className="rounded-full border border-distress/40 bg-distress/15 px-4 py-2 text-xs font-semibold text-distress shadow-lg backdrop-blur-md animate-pulse">
              Click map to add waypoints · {routePoints.length} point
              {routePoints.length !== 1 ? "s" : ""}
            </div>
          </div>
        )}

        {/* Right-side detail panel */}
        <div
          className={`fixed right-0 z-[400] flex flex-col border-l border-foam/10 bg-ocean/95 backdrop-blur-md transition-transform duration-300 ease-in-out
            ${panelOpen ? "translate-x-0" : "translate-x-full"}
          `}
          style={{
            top: "var(--rescue-panel-top, 0px)",
            bottom: 0,
            width: "clamp(320px, 380px, 100vw)",
          }}
        >
          {panelOpen && selected && (
            <DetailPanel
              alert={selected}
              now={now}
              live={live}
              gpsAgeS={gpsAgeS}
              detailTrail={detailTrail}
              detailFollowLive={detailFollowLive}
              detailShowTrail={detailShowTrail}
              detailRescueOp={detailRescueOp}
              detailOpBusy={detailOpBusy}
              detailOpNotes={detailOpNotes}
              detailOpTeam={detailOpTeam}
              selectedIsActive={selectedIsActive}
              onClose={() => setSelectedId(null)}
              onSetFollowLive={setDetailFollowLive}
              onSetShowTrail={setDetailShowTrail}
              onSetOpNotes={setDetailOpNotes}
              onSetOpTeam={setDetailOpTeam}
              onCreateRescueOp={createRescueOp}
              onCloseRescueOp={closeRescueOp}
              onSetStatus={setStatus}
              onZoomToLocation={zoomToLocation}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Build divIcon for a marker ─────────────────────────────────────────────
function buildMarkerIcon(
  L: typeof import("leaflet"),
  _a: AlertJoined,
  isActive: boolean,
  isSelected: boolean,
) {
  if (!isActive) {
    // Small grey resolved dot with white outline for contrast on light/dark maps
    const size = isSelected ? 10 : 8;
    return L.divIcon({
      className: "",
      html: `<div style="width:${size}px;height:${size}px;border-radius:9999px;background:#6b8ca0;border:2px solid rgba(255,255,255,0.9);box-shadow:0 0 4px rgba(0,0,0,0.3)"></div>`,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
    });
  }

  // Determine pulsing colors based on alert status
  let pulseColor = "rgba(225,53,69,0.5)"; // default red
  let dotColor = "#e13545"; // default red

  if (_a.status === "acknowledged" || _a.status === "assigned") {
    pulseColor = "rgba(245,158,11,0.5)"; // orange/amber
    dotColor = "#f59e0b"; // orange/amber
  } else if (_a.status === "in_progress") {
    pulseColor = "rgba(20,184,166,0.5)"; // cyan/teal
    dotColor = "#14b8a6"; // cyan/teal
  }

  const dotSize = isSelected ? 28 : 20;
  const html = `<div style="position:relative;cursor:pointer;width:${dotSize}px;height:${dotSize}px">
    <div style="position:absolute;inset:0;border-radius:9999px;background:${pulseColor};animation:sos-pulse 1.2s ease-out infinite"></div>
    <div style="position:absolute;inset:0;border-radius:9999px;background:${pulseColor};animation:sos-pulse 1.2s ease-out infinite;animation-delay:.6s"></div>
    <div style="position:absolute;inset:${Math.round(dotSize * 0.28)}px;border-radius:9999px;background:${dotColor};border:2px solid rgba(255,255,255,0.95);box-shadow:${isSelected ? "0 0 0 3px rgba(255,255,255,0.95)" : "0 0 6px rgba(0,0,0,0.4)"}"></div>
  </div>`;

  return L.divIcon({
    className: "",
    html,
    iconSize: [dotSize, dotSize],
    iconAnchor: [dotSize / 2, dotSize / 2],
  });
}

// ── Detail panel (right-side slide-in) ────────────────────────────────────
interface DetailPanelProps {
  alert: AlertJoined;
  now: number;
  live: { lat: number; lng: number; accuracy: number | null } | null;
  gpsAgeS: number | null;
  detailTrail: GpsLog[];
  detailFollowLive: boolean;
  detailShowTrail: boolean;
  detailRescueOp: RescueOperation | null;
  detailOpBusy: boolean;
  detailOpNotes: string;
  detailOpTeam: string;
  selectedIsActive: boolean;
  onClose: () => void;
  onSetFollowLive: (v: boolean) => void;
  onSetShowTrail: (v: boolean) => void;
  onSetOpNotes: (v: string) => void;
  onSetOpTeam: (v: string) => void;
  onCreateRescueOp: () => void;
  onCloseRescueOp: (id: string) => void;
  onSetStatus: (s: AlertStatus) => void;
  onZoomToLocation: () => void;
}

function DetailPanel({
  alert,
  now,
  live,
  gpsAgeS,
  detailTrail,
  detailFollowLive,
  detailShowTrail,
  detailRescueOp,
  detailOpBusy,
  detailOpNotes,
  detailOpTeam,
  selectedIsActive,
  onClose,
  onSetFollowLive,
  onSetShowTrail,
  onSetOpNotes,
  onSetOpTeam,
  onCreateRescueOp,
  onCloseRescueOp,
  onSetStatus,
  onZoomToLocation,
}: DetailPanelProps) {
  const isActive = selectedIsActive;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Panel header */}
      <div className="flex items-center justify-between border-b border-foam/10 px-4 py-3">
        <div
          className={`inline-flex items-center gap-1.5 text-[11px] uppercase tracking-wider ${isActive ? "text-distress" : "text-tide"}`}
        >
          {isActive ? (
            <>
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-distress" />{" "}
              {ALERT_STATUS_LABEL[alert.status]}
            </>
          ) : (
            <>
              <CheckCircle2 className="h-3.5 w-3.5" /> {ALERT_STATUS_LABEL[alert.status]}
            </>
          )}
        </div>
        <div className="flex items-center gap-3">
          <div className="text-[11px] text-foam/50">
            {fmtDuration(now - new Date(alert.started_at).getTime())}
          </div>
          <button onClick={onClose} className="rounded-md p-1 hover:bg-foam/10" aria-label="Close">
            <X className="h-4 w-4 text-foam/60" />
          </button>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {(alert.emergency_level || alert.battery != null) && (
          <div className="flex items-center gap-2 text-[11px]">
            {alert.emergency_level && (
              <span
                className={`rounded-md border border-foam/15 px-2 py-0.5 font-semibold uppercase tracking-wider ${EMERGENCY_LEVEL_COLOR[alert.emergency_level] ?? "text-foam"}`}
              >
                {alert.emergency_level}
              </span>
            )}
            {alert.battery != null && (
              <span
                className={`rounded-md border border-foam/15 px-2 py-0.5 tabular-nums ${alert.battery < 20 ? "text-distress" : "text-foam/70"}`}
              >
                🔋 {alert.battery}%
              </span>
            )}
          </div>
        )}

        <div>
          <div className="text-lg font-semibold">{alert.boat?.name ?? "Unknown vessel"}</div>
          <div className="text-xs text-foam/60">
            {alert.boat?.registration_number && (
              <span className="font-mono">{alert.boat.registration_number}</span>
            )}
            {alert.boat?.boat_type && <span> · {alert.boat.boat_type}</span>}
          </div>
        </div>

        <div className="rounded-lg border border-foam/10 bg-foam/[0.03] p-3 text-xs">
          <div className="text-[10px] uppercase tracking-wider text-foam/40">Captain</div>
          <div className="mt-0.5 font-medium">{alert.fisherman?.full_name ?? "Unknown"}</div>
          {alert.fisherman?.phone && <div className="text-foam/60">{alert.fisherman.phone}</div>}
          {alert.fisherman?.national_id && (
            <div className="text-foam/40 text-[10px]">ID {alert.fisherman.national_id}</div>
          )}
        </div>

        <div className="text-[11px] text-foam/40">
          BMU: {alert.bmu?.name ?? "—"} · Device:{" "}
          <span className="font-mono text-tide">{alert.device?.device_id}</span>
        </div>

        <div className="grid grid-cols-2 gap-3 text-xs">
          <Stat label="Latitude" value={live ? live.lat.toFixed(5) : "—"} />
          <Stat label="Longitude" value={live ? live.lng.toFixed(5) : "—"} />
          <Stat
            label="Accuracy"
            value={live?.accuracy != null ? `± ${Math.round(live.accuracy)} m` : "—"}
          />
          <Stat label="GPS age" value={gpsAgeS != null ? `${gpsAgeS}s` : "—"} />
        </div>

        <button
          onClick={onZoomToLocation}
          className="inline-flex items-center gap-2 rounded-lg border border-tide/30 bg-tide/5 px-3 py-2 text-xs font-semibold text-tide hover:bg-tide/10 transition"
        >
          <MapPin className="h-3.5 w-3.5" />
          Zoom to location
        </button>

        {detailTrail.length > 0 && (
          <div className="flex items-center gap-2 text-[11px] text-foam/50 flex-wrap">
            <Navigation className="h-3 w-3 text-tide" />
            <span>Live tracking {detailFollowLive ? "on" : "off"}</span>
            <button
              onClick={() => onSetFollowLive(!detailFollowLive)}
              className="rounded border border-foam/15 px-1.5 py-0.5 text-[10px] hover:bg-foam/10"
            >
              {detailFollowLive ? "Unlock map" : "Follow"}
            </button>
            <button
              onClick={() => onSetShowTrail(!detailShowTrail)}
              className="rounded border border-foam/15 px-1.5 py-0.5 text-[10px] hover:bg-foam/10"
            >
              {detailShowTrail ? "Hide trail" : "Show trail"} ({detailTrail.length})
            </button>
          </div>
        )}

        {alert.fisherman?.emergency_contact_phone && (
          <div className="rounded-lg border border-foam/10 bg-foam/[0.04] p-2 text-[11px] text-foam/70">
            <div className="uppercase tracking-wider text-foam/40">Emergency contact</div>
            <div>
              {alert.fisherman.emergency_contact_name ?? "—"} ·{" "}
              {alert.fisherman.emergency_contact_phone}
            </div>
          </div>
        )}

        {/* Low battery warning */}
        {alert.battery != null && alert.battery < 20 && (
          <div className="rounded-lg border border-distress/40 bg-distress/10 px-3 py-2 text-[11px] text-distress">
            ⚠️ Low battery: {alert.battery}% — device may stop transmitting soon.
          </div>
        )}

        {/* Rescue operation panel */}
        <div className="border-t border-foam/10 pt-4">
          <div className="mb-2 text-[10px] uppercase tracking-wider text-foam/40">
            Rescue Operation
          </div>
          {detailRescueOp ? (
            <div className="space-y-2">
              <div className="rounded-lg border border-tide/30 bg-tide/5 px-3 py-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-tide">
                    {detailRescueOp.team_name ?? "Team assigned"}
                  </span>
                  <span className="text-foam/40">
                    {detailRescueOp.ended_at ? "Closed" : "Active"}
                  </span>
                </div>
                <div className="mt-1 text-foam/60">
                  Started: {new Date(detailRescueOp.started_at).toLocaleString()}
                </div>
                {detailRescueOp.ended_at && (
                  <div className="text-foam/60">
                    Ended: {new Date(detailRescueOp.ended_at).toLocaleString()}
                  </div>
                )}
              </div>
              {!detailRescueOp.ended_at && (
                <div className="space-y-1">
                  <textarea
                    value={detailOpNotes}
                    onChange={(e) => onSetOpNotes(e.target.value)}
                    placeholder="Close-out notes…"
                    rows={2}
                    className="w-full rounded-lg border border-foam/10 bg-ocean/60 px-2 py-1.5 text-xs text-foam outline-none focus:border-tide/60 resize-none"
                  />
                  <button
                    onClick={() => onCloseRescueOp(detailRescueOp.id)}
                    disabled={detailOpBusy}
                    className="w-full rounded-lg border border-tide/30 px-3 py-1.5 text-xs text-tide hover:bg-tide/10 disabled:opacity-60"
                  >
                    {detailOpBusy ? "Saving…" : "Close operation & resolve alert"}
                  </button>
                </div>
              )}
            </div>
          ) : isActive ? (
            <div className="space-y-1">
              <input
                value={detailOpTeam}
                onChange={(e) => onSetOpTeam(e.target.value)}
                placeholder="Team name (e.g. Coastguard Alpha)"
                className="w-full rounded-lg border border-foam/10 bg-ocean/60 px-2 py-1.5 text-xs text-foam outline-none focus:border-tide/60"
              />
              <textarea
                value={detailOpNotes}
                onChange={(e) => onSetOpNotes(e.target.value)}
                placeholder="Notes / ETA…"
                rows={2}
                className="w-full rounded-lg border border-foam/10 bg-ocean/60 px-2 py-1.5 text-xs text-foam outline-none focus:border-tide/60 resize-none"
              />
              <button
                onClick={onCreateRescueOp}
                disabled={detailOpBusy}
                className="w-full rounded-lg bg-tide px-3 py-1.5 text-xs font-semibold text-ocean hover:bg-tide/90 disabled:opacity-60"
              >
                {detailOpBusy ? "Saving…" : "Assign rescue team"}
              </button>
            </div>
          ) : (
            <div className="text-xs text-foam/40">Alert resolved — no active rescue operation.</div>
          )}
        </div>

        <div className="pb-4">
          <div className="mb-1 text-[10px] uppercase tracking-wider text-foam/40">
            Rescue workflow
          </div>
          <select
            value={alert.status}
            onChange={(e) => onSetStatus(e.target.value as AlertStatus)}
            className="w-full rounded-lg border border-foam/10 bg-ocean/60 px-3 py-2 text-xs outline-none focus:border-tide/60"
          >
            {ALERT_STATUSES.map((s) => (
              <option key={s} value={s} className="bg-ocean">
                {ALERT_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}

// ── Shared sub-components ─────────────────────────────────────────────────
function StatCell({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: number;
  tone: "distress" | "tide" | "foam" | "muted";
  icon: React.ReactNode;
}) {
  const color =
    tone === "distress"
      ? "text-distress"
      : tone === "tide"
        ? "text-tide"
        : tone === "foam"
          ? "text-foam"
          : "text-foam/50";
  return (
    <div className="bg-ocean px-4 py-3">
      <div
        className={`inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider ${color}`}
      >
        {icon}
        {label}
      </div>
      <div
        className={`mt-1 text-2xl font-semibold tabular-nums ${tone === "muted" ? "text-foam/70" : color}`}
      >
        {value}
      </div>
    </div>
  );
}

function EmergencyBanner({
  count,
  topAlert,
  muted,
  audioReady,
  onEnableAudio,
  onMute,
  onAcknowledge,
  onView,
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
            {topAlert.boat?.name ?? "Unknown vessel"} ·{" "}
            {topAlert.fisherman?.full_name ?? "Unknown captain"}
            {topAlert.emergency_level && (
              <span className="ml-2 rounded bg-black/25 px-1.5 py-0.5 text-[10px]">
                {topAlert.emergency_level}
              </span>
            )}
          </div>
        </div>
        <button
          onClick={onView}
          className="rounded-lg bg-black/30 px-3 py-1.5 text-xs font-semibold hover:bg-black/40"
        >
          View incident
        </button>
        <button
          onClick={onAcknowledge}
          className="rounded-lg bg-foam px-3 py-1.5 text-xs font-semibold text-distress hover:bg-foam/90"
        >
          Acknowledge all
        </button>
        {!audioReady ? (
          <button
            onClick={onEnableAudio}
            className="inline-flex animate-bounce items-center gap-1.5 rounded-lg bg-yellow-400 px-3 py-1.5 text-xs font-bold text-black hover:bg-yellow-300"
          >
            <Volume2 className="h-3.5 w-3.5" /> Enable sound
          </button>
        ) : (
          <button
            onClick={onMute}
            className={`rounded-lg border border-foam/40 px-3 py-1.5 text-xs hover:bg-foam/10 ${muted ? "opacity-50" : ""}`}
          >
            {muted ? "Muted" : "Mute alarm"}
          </button>
        )}
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
