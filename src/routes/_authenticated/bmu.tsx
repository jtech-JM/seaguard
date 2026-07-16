import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTheme } from "@/lib/theme";
import { Sun, Moon } from "lucide-react";
import type { BMU, Boat, Device, Fisherman, TripStatus } from "@/lib/marine-types";
import { TRIP_STATUS_LABEL, TRIP_STATUS_TONE } from "@/lib/marine-types";
import { requireRole, type RouteContext } from "@/lib/route-guard";
import { canTransitionTripStatus } from "@/lib/trip-status";
import { STAFF_ROLES } from "@/lib/use-role";

import {
  manageBoat,
  manageCrewMember,
  manageDevice,
  manageFisherman,
  transitionTrip,
  linkProfile,
  unlinkProfile,
} from "@/lib/bmu-ops";
import {
  Anchor,
  Cpu,
  LifeBuoy,
  LogOut,
  Pencil,
  Plus,
  Radio,
  Search,
  Ship,
  Trash2,
  Users,
  X,
  ClipboardList,
  Link2,
  Filter,
  TrendingUp,
  Activity,
  Ship as ShipIcon,
  Cpu as CpuIcon,
  Users as UsersIcon,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/bmu")({
  beforeLoad: ({ context }) => requireRole(context as RouteContext, ["bmu_officer"]),
  head: () => ({
    meta: [
      { title: "BMU Registration — MarineRescue" },
      {
        name: "description",
        content: "Register fishermen, boats, SOS devices and manage sea trips.",
      },
    ],
  }),
  component: BMUDashboard,
});

type Tab = "trips" | "fishermen" | "boats" | "devices" | "bmus";

interface SeaTrip {
  id: string;
  status: TripStatus;
  destination: string | null;
  fishing_area: string | null;
  planned_departure: string | null;
  actual_departure: string | null;
  expected_return: string | null;
  actual_return: string | null;
  notes: string | null;
  captain?: { full_name: string; phone: string | null } | null;
  boat?: { name: string; registration_number: string | null } | null;
}

interface Profile {
  id: string;
  full_name: string | null;
  email: string | null;
  fisherman_id: string | null;
}

function BMUDashboard() {
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();
  const [tab, setTab] = useState<Tab>("fishermen");
  const [filterOpen, setFilterOpen] = useState(false);
  const [bmus, setBMUs] = useState<BMU[]>([]);
  const [fishermen, setFishermen] = useState<Fisherman[]>([]);
  const [boats, setBoats] = useState<Boat[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [trips, setTrips] = useState<SeaTrip[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [q, setQ] = useState("");
  const addHandlers = useRef<Record<string, (() => void) | undefined>>({});

  async function refresh() {
    const [bRes, fRes, boRes, dRes, tRes] = await Promise.all([
      supabase.from("bmus").select("*").order("name").limit(100),
      supabase.from("fishermen").select("*").order("full_name").limit(100),
      supabase.from("boats").select("*").order("name").limit(100),
      supabase.from("devices").select("*").order("device_id").limit(100),
      supabase
        .from("sea_trips")
        .select("*, captain:captain_id(full_name,phone), boat:boat_id(name,registration_number)")
        .order("created_at", { ascending: false })
        .limit(100),
    ]);
    setBMUs((bRes.data as BMU[]) ?? []);
    setFishermen((fRes.data as Fisherman[]) ?? []);
    setBoats((boRes.data as Boat[]) ?? []);
    setDevices((dRes.data as Device[]) ?? []);
    const tripRows = (tRes.data as SeaTrip[]) ?? [];
    setTrips(tripRows);
    setPendingCount(tripRows.filter((t) => t.status === "pending_approval").length);
  }

  useEffect(() => {
    refresh();
    // Realtime: refresh on any trip or fishermen/devices change
    const ch = supabase
      .channel("bmu-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "sea_trips" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "fishermen" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "devices" }, refresh)
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, []);

  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/auth" });
  }

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-foreground">
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-border bg-white px-6 py-3.5 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 ring-1 ring-primary/15">
            <LifeBuoy className="h-5 w-5 text-primary" />
          </div>
          <div className="leading-tight">
            <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              BMU Console
            </div>
            <div className="text-[15px] font-bold tracking-tight text-foreground">
              Registration &amp; Fleet Management
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setTheme(theme === "light" ? "dark" : "light")}
            aria-label="Toggle theme"
            title={`Switch to ${theme === "light" ? "dark" : "light"} theme`}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground shadow-sm transition-all duration-150 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {theme === "light" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
          </button>
          <button
            onClick={signOut}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-muted-foreground shadow-sm transition-colors duration-150 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>
      </header>

      <div className="border-b border-border bg-background px-6">
        <nav className="flex flex-wrap gap-1.5 py-3">
          <TabBtn
            active={tab === "trips"}
            onClick={() => setTab("trips")}
            icon={<ClipboardList className="h-4 w-4" />}
            label="Sea Trips"
            count={pendingCount}
            countTone="warn"
          />
          <TabBtn
            active={tab === "fishermen"}
            onClick={() => setTab("fishermen")}
            icon={<Users className="h-4 w-4" />}
            label="Fishermen"
            count={fishermen.length}
          />
          <TabBtn
            active={tab === "boats"}
            onClick={() => setTab("boats")}
            icon={<Ship className="h-4 w-4" />}
            label="Boats"
            count={boats.length}
          />
          <TabBtn
            active={tab === "devices"}
            onClick={() => setTab("devices")}
            icon={<Cpu className="h-4 w-4" />}
            label="Devices"
            count={devices.length}
          />
          <TabBtn
            active={tab === "bmus"}
            onClick={() => setTab("bmus")}
            icon={<Anchor className="h-4 w-4" />}
            label="BMUs"
            count={bmus.length}
          />
        </nav>
      </div>

      <div className="mx-auto max-w-7xl px-6 py-6">
        <div className="mb-6 flex flex-wrap items-center gap-2">
          <div className="relative w-full max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search records…"
              className="w-full rounded-full border border-border bg-white py-2 pl-9 pr-3 text-sm text-foreground shadow-sm outline-none transition-colors duration-150 placeholder:text-muted-foreground/70 focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
            />
          </div>
          <button
            onClick={() => setFilterOpen((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-white px-3.5 py-2 text-sm font-medium text-muted-foreground shadow-sm transition-colors duration-150 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <Filter className="h-4 w-4" /> Filter
          </button>
          <button
            onClick={() => {
              const ev = addHandlers[tab];
              ev?.();
            }}
            className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3.5 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-colors duration-150 hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <Plus className="h-4 w-4" /> Add
          </button>
        </div>

        {filterOpen && (
          <div className="mb-5 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-white p-3 shadow-sm">
            <FilterChip label="Status" options={["Active", "Inactive"]} />
            <FilterChip label="BMU" options={bmus.map((b) => b.name)} />
            <FilterChip label="Captain" options={["Certified", "Crew only"]} />
            <button
              onClick={() => setFilterOpen(false)}
              className="ml-auto inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" /> Close
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[1fr_20rem]">
          <div className="min-w-0">
            {tab === "trips" && <TripsSection items={trips} q={q} onChange={refresh} />}
            {tab === "fishermen" && (
              <FishermenSection
                items={fishermen}
                bmus={bmus}
                q={q}
                onChange={refresh}
                addHandlers={addHandlers}
              />
            )}
            {tab === "boats" && (
              <BoatsSection
                items={boats}
                bmus={bmus}
                fishermen={fishermen}
                q={q}
                onChange={refresh}
                addHandlers={addHandlers}
              />
            )}
            {tab === "devices" && (
              <DevicesSection
                items={devices}
                fishermen={fishermen}
                q={q}
                onChange={refresh}
                addHandlers={addHandlers}
              />
            )}
            {tab === "bmus" && (
              <BMUsSection items={bmus} q={q} onChange={refresh} addHandlers={addHandlers} />
            )}
          </div>

          <aside className="lg:sticky lg:top-32 h-fit">
            <AnalyticsSidebar fishermen={fishermen} boats={boats} devices={devices} trips={trips} />
          </aside>
        </div>
      </div>
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  icon,
  label,
  count,
  countTone,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  count: number;
  countTone?: "warn";
}) {
  const badgeCls =
    countTone === "warn" && count > 0
      ? "bg-amber-100 text-amber-700"
      : "bg-muted text-muted-foreground";
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-sm font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
        active
          ? "bg-primary text-primary-foreground shadow-sm"
          : "bg-transparent text-muted-foreground hover:bg-accent hover:text-foreground"
      }`}
    >
      {icon} {label}
      {count > 0 && (
        <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${badgeCls}`}>
          {count}
        </span>
      )}
    </button>
  );
}

// ──────────────────── SEA TRIPS APPROVAL QUEUE ────────────────────
function TripsSection({
  items,
  q,
  onChange,
}: {
  items: SeaTrip[];
  q: string;
  onChange: () => void;
}) {
  const [crewTripId, setCrewTripId] = useState<string | null>(null);

  const filtered = items.filter((t) =>
    [t.captain?.full_name, t.boat?.name, t.destination, t.fishing_area, t.status]
      .join(" ")
      .toLowerCase()
      .includes(q.toLowerCase()),
  );

  const pending = filtered.filter((t) => t.status === "pending_approval");
  const rest = filtered.filter((t) => t.status !== "pending_approval");

  async function approve(id: string, currentStatus: SeaTrip["status"]) {
    if (!canTransitionTripStatus(currentStatus, "at_sea")) {
      return;
    }
    const { error } = await transitionTrip(id, "at_sea");
    if (error) {
      window.alert(error.message);
    }
    onChange();
  }
  async function reject(id: string, currentStatus: SeaTrip["status"]) {
    if (!canTransitionTripStatus(currentStatus, "cancelled")) {
      return;
    }
    const reason = window.prompt("Please provide a short reason for rejecting this trip request:");
    if (!reason || reason.trim().length === 0) {
      window.alert("A rejection reason is required.");
      return;
    }
    const { error } = await transitionTrip(id, "cancelled", reason);
    if (error) {
      window.alert(error.message);
    }
    onChange();
  }
  async function markOverdue(id: string) {
    const { error } = await transitionTrip(id, "overdue");
    if (error) {
      window.alert(error.message);
    }
    onChange();
  }

  return (
    <>
      {pending.length > 0 && (
        <div className="mb-6">
          <div className="mb-3 flex items-center gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-amber-700">
              Pending Approval ({pending.length})
            </h2>
          </div>
          <div className="space-y-2">
            {pending.map((t) => (
              <div
                key={t.id}
                className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-300/60 bg-amber-50 px-4 py-3"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-foreground">
                    {t.captain?.full_name ?? "—"}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {t.boat?.name ?? "—"} · {t.destination ?? "No destination"}
                  </div>
                  {t.expected_return && (
                    <div className="text-[11px] text-muted-foreground/70">
                      Expected return: {new Date(t.expected_return).toLocaleString()}
                    </div>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setCrewTripId(t.id)}
                    className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs font-medium text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    Crew
                  </button>
                  <button
                    onClick={() => reject(t.id, t.status)}
                    className="rounded-lg border border-destructive/40 px-3 py-1.5 text-xs font-medium text-destructive transition-colors duration-150 hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    Reject
                  </button>
                  <button
                    onClick={() => approve(t.id, t.status)}
                    className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-colors duration-150 hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    Approve &amp; Dispatch
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <SectionHeader title="All Trips" onAdd={undefined} />
      <div className="overflow-hidden rounded-xl border border-border bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/50 text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 text-left font-medium">Captain</th>
                <th className="px-4 py-2.5 text-left font-medium">Boat</th>
                <th className="px-4 py-2.5 text-left font-medium">Status</th>
                <th className="px-4 py-2.5 text-left font-medium">Destination</th>
                <th className="px-4 py-2.5 text-left font-medium">Expected Return</th>
                <th className="px-4 py-2.5 text-left font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rest.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                    No trips.
                  </td>
                </tr>
              )}
              {rest.map((t) => {
                const tone = TRIP_STATUS_TONE[t.status];
                const isOverdueable =
                  t.status === "at_sea" &&
                  t.expected_return &&
                  new Date(t.expected_return) < new Date();
                return (
                  <tr key={t.id} className="transition-colors duration-150 hover:bg-muted/50">
                    <td className="px-4 py-3 font-medium text-foreground">
                      {t.captain?.full_name ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{t.boat?.name ?? "—"}</td>
                    <td className="px-4 py-3">
                      <StatusChip tone={tone}>{TRIP_STATUS_LABEL[t.status]}</StatusChip>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{t.destination ?? "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">
                      {t.expected_return ? new Date(t.expected_return).toLocaleString() : "—"}
                      {isOverdueable && (
                        <span className="ml-2 font-semibold text-destructive">OVERDUE</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <button
                          onClick={() => setCrewTripId(t.id)}
                          className="rounded-md p-1.5 text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          title="Manage crew"
                        >
                          <Users className="h-3.5 w-3.5" />
                        </button>
                        {isOverdueable && (
                          <button
                            onClick={() => markOverdue(t.id)}
                            className="rounded-md px-2 py-1 text-[10px] font-medium text-destructive transition-colors duration-150 hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            Mark Overdue
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {crewTripId && (
        <CrewModal tripId={crewTripId} fishermen={[]} onClose={() => setCrewTripId(null)} />
      )}
    </>
  );
}

// ──────────────────── CREW MODAL ────────────────────
function CrewModal({
  tripId,
  fishermen: _ignored,
  onClose,
}: {
  tripId: string;
  fishermen: Fisherman[];
  onClose: () => void;
}) {
  const [crew, setCrew] = useState<
    Array<{
      id: string;
      fisherman_id: string;
      role: string | null;
      fisherman?: { full_name: string; phone: string | null } | null;
    }>
  >([]);
  const [allFishermen, setAllFishermen] = useState<Fisherman[]>([]);
  const [addId, setAddId] = useState("");
  const [addRole, setAddRole] = useState("");
  const [busy, setBusy] = useState(false);

  const loadCrew = useCallback(async () => {
    const [{ data: c }, { data: f }] = await Promise.all([
      supabase
        .from("trip_crew")
        .select("*, fisherman:fisherman_id(full_name,phone)")
        .eq("trip_id", tripId),
      supabase.from("fishermen").select("id,full_name,phone").order("full_name"),
    ]);
    setCrew((c as typeof crew) ?? []);
    setAllFishermen((f as Fisherman[]) ?? []);
  }, [tripId]);

  useEffect(() => {
    loadCrew();
  }, [loadCrew]);

  async function addMember() {
    if (!addId) return;
    setBusy(true);
    const { error } = await manageCrewMember({
      action: "add",
      tripId,
      fishermanId: addId,
      role: addRole || null,
    });
    setAddId("");
    setAddRole("");
    if (!error) {
      await loadCrew();
    } else {
      window.alert(error.message);
    }
    setBusy(false);
  }

  async function removeMember(id: string) {
    const { error } = await manageCrewMember({ action: "remove", tripId, crewId: id });
    if (!error) {
      loadCrew();
    } else {
      window.alert(error.message);
    }
  }

  const crewIds = new Set(crew.map((c) => c.fisherman_id));
  const available = allFishermen.filter((f) => !crewIds.has(f.id));

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-border bg-white p-5 text-foreground shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold">Trip Crew</h3>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-2 mb-4">
          {crew.length === 0 && (
            <div className="text-sm text-muted-foreground">No crew members yet.</div>
          )}
          {crew.map((c) => (
            <div
              key={c.id}
              className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2"
            >
              <div>
                <div className="text-sm font-medium text-foreground">
                  {c.fisherman?.full_name ?? c.fisherman_id}
                </div>
                {c.role && <div className="text-[11px] text-muted-foreground">{c.role}</div>}
              </div>
              <button
                onClick={() => removeMember(c.id)}
                className="text-muted-foreground transition-colors duration-150 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
        {available.length > 0 && (
          <div className="space-y-2 border-t border-border pt-3">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Add crew member
            </div>
            <div className="flex gap-2">
              <select
                value={addId}
                onChange={(e) => setAddId(e.target.value)}
                className="flex-1 rounded-lg border border-input bg-background px-2 py-2 text-sm text-foreground outline-none transition-colors duration-150 focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">Select fisherman</option>
                {available.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.full_name}
                  </option>
                ))}
              </select>
              <input
                value={addRole}
                onChange={(e) => setAddRole(e.target.value)}
                placeholder="Role"
                className="w-28 rounded-lg border border-input bg-background px-2 py-2 text-sm text-foreground outline-none transition-colors duration-150 focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            <button
              onClick={addMember}
              disabled={busy || !addId}
              className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-colors duration-150 hover:bg-primary/90 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              Add
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ──────────────────── FISHERMEN (with profile link) ────────────────────
function FishermenSection({
  items,
  bmus,
  q,
  onChange,
  addHandlers,
}: {
  items: Fisherman[];
  bmus: BMU[];
  q: string;
  onChange: () => void;
  addHandlers: React.MutableRefObject<Record<string, (() => void) | undefined>>;
}) {
  const [editing, setEditing] = useState<Fisherman | null>(null);
  const [open, setOpen] = useState(false);
  const [linkFisherman, setLinkFisherman] = useState<Fisherman | null>(null);
  const filtered = items.filter((f) =>
    [f.full_name, f.phone, f.national_id].join(" ").toLowerCase().includes(q.toLowerCase()),
  );
  const bmuName = (id: string | null) => bmus.find((b) => b.id === id)?.name ?? "—";

  useEffect(() => {
    const registry = addHandlers.current;
    registry["fishermen"] = () => {
      setEditing(null);
      setOpen(true);
    };
    return () => {
      delete registry["fishermen"];
    };
  });

  return (
    <>
      <SectionHeader
        title="Registered Fishermen"
        onAdd={() => {
          setEditing(null);
          setOpen(true);
        }}
      />
      <Table
        cols={["Name", "Phone", "National ID", "BMU", "Emergency", "Captain", "Status", ""]}
        rows={filtered.map((f) => [
          <span className="font-medium text-foreground">{f.full_name}</span>,
          f.phone ?? "—",
          f.national_id ?? "—",
          bmuName(f.bmu_id),
          f.emergency_contact_phone ?? "—",
          f.is_certified_captain ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
              ⚓ Certified
            </span>
          ) : (
            <span className="text-[11px] text-muted-foreground/70">Crew only</span>
          ),
          <Badge tone={f.active ? "tide" : "muted"}>{f.active ? "Active" : "Inactive"}</Badge>,
          <div className="flex justify-end gap-1">
            <button
              onClick={() => setLinkFisherman(f)}
              className="rounded-md p-1.5 text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              title="Link to user account"
            >
              <Link2 className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => {
                setEditing(f);
                setOpen(true);
              }}
              className="rounded-md p-1.5 text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={async () => {
                if (!confirm("Delete this fisherman?")) return;
                const { error } = await manageFisherman({ action: "delete", id: f.id });
                if (!error) {
                  onChange();
                } else {
                  window.alert(error.message);
                }
              }}
              className="rounded-md p-1.5 text-muted-foreground transition-colors duration-150 hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>,
        ])}
      />
      {open && (
        <FishermanModal
          initial={editing}
          bmus={bmus}
          onClose={() => setOpen(false)}
          onSaved={() => {
            setOpen(false);
            onChange();
          }}
        />
      )}
      {linkFisherman && (
        <LinkProfileModal
          fisherman={linkFisherman}
          onClose={() => setLinkFisherman(null)}
          onSaved={() => {
            setLinkFisherman(null);
            onChange();
          }}
        />
      )}
    </>
  );
}

function LinkProfileModal({
  fisherman,
  onClose,
  onSaved,
}: {
  fisherman: Fisherman;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [searchEmail, setSearchEmail] = useState("");
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [currentLink, setCurrentLink] = useState<Profile | null>(null);
  const [busy, setBusy] = useState(false);
  const [searching, setSearching] = useState(false);

  // Load the current link on mount
  useEffect(() => {
    supabase
      .from("profiles")
      .select("id,full_name,email,fisherman_id")
      .eq("fisherman_id", fisherman.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          const linked = data as Profile;
          setCurrentLink(linked);
          setSelectedProfileId(linked.id);
        }
      });
  }, [fisherman.id]);

  async function performSearch(query: string) {
    if (!query || query.trim().length < 2) {
      setProfiles([]);
      return;
    }
    setSearching(true);
    try {
      const [{ data: found }, { data: staff }] = await Promise.all([
        supabase
          .from("profiles")
          .select("id,full_name,email,fisherman_id")
          .ilike("email", `%${query.trim()}%`)
          .limit(20),
        supabase.from("user_roles").select("user_id").in("role", STAFF_ROLES),
      ]);
      const staffIds = new Set((staff ?? []).map((r) => r.user_id));
      const filtered = ((found as Profile[]) ?? []).filter((prof) => !staffIds.has(prof.id));
      setProfiles(filtered);
    } catch (err) {
      console.error("Search failed:", err);
    } finally {
      setSearching(false);
    }
  }

  async function save() {
    setBusy(true);
    try {
      if (currentLink && currentLink.id !== selectedProfileId) {
        await unlinkProfile(currentLink.id);
      }
      if (selectedProfileId) {
        await linkProfile(selectedProfileId, fisherman.id);
      }
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  const dropdownOptions = [
    { value: "", label: "— Unlink —" },
    ...(currentLink
      ? [
          {
            value: currentLink.id,
            label: `${currentLink.full_name ?? "—"} (${currentLink.email}) [Current]`,
          },
        ]
      : []),
    ...profiles
      .filter((p) => p.id !== currentLink?.id)
      .map((p) => ({ value: p.id, label: `${p.full_name ?? "—"} (${p.email})` })),
  ];

  return (
    <Modal title={`Link account → ${fisherman.full_name}`} onClose={onClose}>
      {currentLink && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
          Currently linked to{" "}
          <span className="font-semibold text-foreground">
            {currentLink.full_name ?? currentLink.email}
          </span>
        </div>
      )}
      <ModalField label="Search profile by email">
        <div className="flex gap-2">
          <Input
            value={searchEmail}
            onChange={(v) => {
              setSearchEmail(v);
              performSearch(v);
            }}
            placeholder="Type email to search database..."
          />
        </div>
      </ModalField>
      <ModalField label="Select user account">
        <Select
          value={selectedProfileId}
          onChange={setSelectedProfileId}
          options={dropdownOptions}
        />
        {searching && (
          <div className="mt-1 text-[10px] text-muted-foreground/70">Searching database...</div>
        )}
      </ModalField>
      <ModalActions onClose={onClose} onSave={save} busy={busy} />
    </Modal>
  );
}

function FishermanModal({
  initial,
  bmus,
  onClose,
  onSaved,
}: {
  initial: Fisherman | null;
  bmus: BMU[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<Partial<Fisherman>>(
    initial ?? {
      full_name: "",
      active: true,
      bmu_id: bmus[0]?.id ?? null,
      is_certified_captain: false,
      captain_license_number: null,
    },
  );
  const [busy, setBusy] = useState(false);

  // ── Account linking (inline) ─────────────────────────────────
  const [searchEmail, setSearchEmail] = useState("");
  const [searchResults, setSearchResults] = useState<Profile[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [currentLink, setCurrentLink] = useState<Profile | null>(null);

  // When editing, pre-load any existing link
  useEffect(() => {
    if (!initial) return;
    supabase
      .from("profiles")
      .select("id,full_name,email,fisherman_id")
      .eq("fisherman_id", initial.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          const linked = data as Profile;
          setCurrentLink(linked);
          setSelectedProfileId(linked.id);
        }
      });
  }, [initial]);

  async function searchProfiles(q: string) {
    setSearchEmail(q);
    if (!q || q.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    try {
      const [{ data: found }, { data: staff }] = await Promise.all([
        supabase
          .from("profiles")
          .select("id,full_name,email,fisherman_id")
          .ilike("email", `%${q.trim()}%`)
          .limit(20),
        supabase.from("user_roles").select("user_id").in("role", STAFF_ROLES),
      ]);
      const staffIds = new Set((staff ?? []).map((r) => r.user_id));
      setSearchResults(((found as Profile[]) ?? []).filter((p) => !staffIds.has(p.id)));
    } finally {
      setSearching(false);
    }
  }

  async function save() {
    setBusy(true);
    try {
      let fishermanId: string;
      if (initial) {
        const { data, error } = await manageFisherman({
          action: "update",
          id: initial.id,
          fullName: form.full_name,
          phone: form.phone,
          nationalId: form.national_id,
          emergencyContactName: form.emergency_contact_name,
          emergencyContactPhone: form.emergency_contact_phone,
          photoUrl: form.photo_url,
          active: form.active,
          bmuId: form.bmu_id,
          isCertifiedCaptain: form.is_certified_captain,
          captainLicenseNumber: form.captain_license_number,
        });
        if (error) throw error;
        fishermanId = initial.id;
      } else {
        const { data, error } = await manageFisherman({
          action: "create",
          fullName: form.full_name,
          phone: form.phone,
          nationalId: form.national_id,
          emergencyContactName: form.emergency_contact_name,
          emergencyContactPhone: form.emergency_contact_phone,
          photoUrl: form.photo_url,
          active: form.active,
          bmuId: form.bmu_id,
          isCertifiedCaptain: form.is_certified_captain,
          captainLicenseNumber: form.captain_license_number,
        });
        if (error) throw error;
        fishermanId = data ?? "";
        if (!fishermanId) {
          throw new Error("Failed to create fisherman");
        }
      }

      if (currentLink && currentLink.id !== selectedProfileId) {
        await unlinkProfile(currentLink.id);
      }
      if (selectedProfileId) {
        await linkProfile(selectedProfileId, fishermanId);
      }

      onSaved();
    } finally {
      setBusy(false);
    }
  }

  const dropdownOptions = [
    { value: "", label: "— No account linked —" },
    ...(currentLink
      ? [
          {
            value: currentLink.id,
            label: `${currentLink.full_name ?? "—"} (${currentLink.email}) [Current]`,
          },
        ]
      : []),
    ...searchResults
      .filter((p) => p.id !== currentLink?.id)
      .map((p) => ({ value: p.id, label: `${p.full_name ?? "—"} (${p.email})` })),
  ];

  return (
    <Modal title={initial ? "Edit fisherman" : "New fisherman"} onClose={onClose}>
      <ModalField label="Full name">
        <Input value={form.full_name ?? ""} onChange={(v) => setForm({ ...form, full_name: v })} />
      </ModalField>
      <div className="grid grid-cols-2 gap-3">
        <ModalField label="Phone">
          <Input value={form.phone ?? ""} onChange={(v) => setForm({ ...form, phone: v })} />
        </ModalField>
        <ModalField label="National ID">
          <Input
            value={form.national_id ?? ""}
            onChange={(v) => setForm({ ...form, national_id: v })}
          />
        </ModalField>
      </div>
      <ModalField label="BMU">
        <Select
          value={form.bmu_id ?? ""}
          onChange={(v) => setForm({ ...form, bmu_id: v || null })}
          options={[
            { value: "", label: "— None —" },
            ...bmus.map((b) => ({ value: b.id, label: b.name })),
          ]}
        />
      </ModalField>
      <div className="grid grid-cols-2 gap-3">
        <ModalField label="Emergency contact name">
          <Input
            value={form.emergency_contact_name ?? ""}
            onChange={(v) => setForm({ ...form, emergency_contact_name: v })}
          />
        </ModalField>
        <ModalField label="Emergency contact phone">
          <Input
            value={form.emergency_contact_phone ?? ""}
            onChange={(v) => setForm({ ...form, emergency_contact_phone: v })}
          />
        </ModalField>
      </div>
      <ModalField label="Photo URL (optional)">
        <Input value={form.photo_url ?? ""} onChange={(v) => setForm({ ...form, photo_url: v })} />
      </ModalField>

      {/* ── Captain certification ──────────────────────────── */}
      <div className="border-t border-border pt-3">
        <div className="mb-2 text-[11px] uppercase tracking-wider text-muted-foreground">
          Captain certification
        </div>
        <label className="flex cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            checked={form.is_certified_captain ?? false}
            onChange={(e) =>
              setForm({
                ...form,
                is_certified_captain: e.target.checked,
                captain_license_number: e.target.checked ? form.captain_license_number : null,
              })
            }
            className="h-4 w-4 rounded border border-input accent-primary"
          />
          <span className="text-sm text-foreground">Certified captain</span>
        </label>
        {form.is_certified_captain && (
          <ModalField label="License number (optional)">
            <Input
              value={form.captain_license_number ?? ""}
              onChange={(v) => setForm({ ...form, captain_license_number: v || null })}
              placeholder="e.g. CPT-2024-00123"
            />
          </ModalField>
        )}
      </div>
      <div className="border-t border-border pt-3">
        <div className="mb-2 text-[11px] uppercase tracking-wider text-muted-foreground">
          Link user account{" "}
          <span className="normal-case text-muted-foreground/60">
            (optional — fisherman must sign up first)
          </span>
        </div>
        {currentLink && (
          <div className="mb-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
            Currently linked to{" "}
            <span className="font-semibold text-foreground">
              {currentLink.full_name ?? currentLink.email}
            </span>
          </div>
        )}
        <ModalField label="Search by email">
          <Input
            value={searchEmail}
            onChange={searchProfiles}
            placeholder="Type email to search…"
          />
          {searching && <div className="mt-1 text-[10px] text-muted-foreground/70">Searching…</div>}
        </ModalField>
        {(searchResults.length > 0 || currentLink) && (
          <ModalField label="Select account">
            <Select
              value={selectedProfileId}
              onChange={setSelectedProfileId}
              options={dropdownOptions}
            />
          </ModalField>
        )}
      </div>

      <ModalActions onClose={onClose} onSave={save} busy={busy} />
    </Modal>
  );
}

// ──────────────────── BOATS ────────────────────
function BoatsSection({
  items,
  bmus,
  fishermen,
  q,
  onChange,
  addHandlers,
}: {
  items: Boat[];
  bmus: BMU[];
  fishermen: Fisherman[];
  q: string;
  onChange: () => void;
  addHandlers: React.MutableRefObject<Record<string, (() => void) | undefined>>;
}) {
  const [editing, setEditing] = useState<Boat | null>(null);
  const [open, setOpen] = useState(false);
  const filtered = items.filter((b) =>
    [b.name, b.registration_number, b.boat_type].join(" ").toLowerCase().includes(q.toLowerCase()),
  );
  const fishName = (id: string | null) => fishermen.find((f) => f.id === id)?.full_name ?? "—";
  const bmuName = (id: string | null) => bmus.find((b) => b.id === id)?.name ?? "—";
  useEffect(() => {
    const registry = addHandlers.current;
    registry["boats"] = () => {
      setEditing(null);
      setOpen(true);
    };
    return () => {
      delete registry["boats"];
    };
  });
  return (
    <>
      <SectionHeader
        title="Registered Boats"
        onAdd={() => {
          setEditing(null);
          setOpen(true);
        }}
      />
      <Table
        cols={["Name", "Reg. No.", "Type", "Owner", "BMU", ""]}
        rows={filtered.map((b) => [
          <span className="font-medium text-foreground">{b.name}</span>,
          b.registration_number ?? "—",
          b.boat_type ?? "—",
          fishName(b.owner_fisherman_id),
          bmuName(b.bmu_id),
          <RowActions
            onEdit={() => {
              setEditing(b);
              setOpen(true);
            }}
            onDelete={async () => {
              if (!confirm("Delete this boat?")) return;
              const { error } = await manageBoat({ action: "delete", id: b.id });
              if (!error) {
                onChange();
              } else {
                window.alert(error.message);
              }
            }}
          />,
        ])}
      />
      {open && (
        <BoatModal
          initial={editing}
          bmus={bmus}
          fishermen={fishermen}
          onClose={() => setOpen(false)}
          onSaved={() => {
            setOpen(false);
            onChange();
          }}
        />
      )}
    </>
  );
}

function BoatModal({
  initial,
  bmus,
  fishermen,
  onClose,
  onSaved,
}: {
  initial: Boat | null;
  bmus: BMU[];
  fishermen: Fisherman[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<Partial<Boat>>(initial ?? { name: "", boat_type: "Trawler" });
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      const { error } = initial
        ? await manageBoat({
            action: "update",
            id: initial.id,
            name: form.name,
            registrationNumber: form.registration_number,
            boatType: form.boat_type,
            ownerFishermanId: form.owner_fisherman_id,
            bmuId: form.bmu_id,
          })
        : await manageBoat({
            action: "create",
            name: form.name,
            registrationNumber: form.registration_number,
            boatType: form.boat_type,
            ownerFishermanId: form.owner_fisherman_id,
            bmuId: form.bmu_id,
          });
      if (error) {
        window.alert(error.message);
      } else {
        onSaved();
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={initial ? "Edit boat" : "New boat"} onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <ModalField label="Boat name">
          <Input value={form.name ?? ""} onChange={(v) => setForm({ ...form, name: v })} />
        </ModalField>
        <ModalField label="Registration number">
          <Input
            value={form.registration_number ?? ""}
            onChange={(v) => setForm({ ...form, registration_number: v })}
          />
        </ModalField>
      </div>
      <ModalField label="Boat type">
        <Select
          value={form.boat_type ?? "Trawler"}
          onChange={(v) => setForm({ ...form, boat_type: v })}
          options={["Trawler", "Canoe", "Skiff", "Long-liner", "Other"].map((o) => ({
            value: o,
            label: o,
          }))}
        />
      </ModalField>
      <ModalField label="Owner (fisherman)">
        <Select
          value={form.owner_fisherman_id ?? ""}
          onChange={(v) => setForm({ ...form, owner_fisherman_id: v || null })}
          options={[
            { value: "", label: "— None —" },
            ...fishermen.map((f) => ({ value: f.id, label: f.full_name })),
          ]}
        />
      </ModalField>
      <ModalField label="BMU">
        <Select
          value={form.bmu_id ?? ""}
          onChange={(v) => setForm({ ...form, bmu_id: v || null })}
          options={[
            { value: "", label: "— None —" },
            ...bmus.map((b) => ({ value: b.id, label: b.name })),
          ]}
        />
      </ModalField>
      <ModalActions onClose={onClose} onSave={save} busy={busy} />
    </Modal>
  );
}

// ──────────────────── DEVICES ────────────────────
function DevicesSection({
  items,
  fishermen,
  q,
  onChange,
  addHandlers,
}: {
  items: Device[];
  fishermen: Fisherman[];
  q: string;
  onChange: () => void;
  addHandlers: React.MutableRefObject<Record<string, (() => void) | undefined>>;
}) {
  const [editing, setEditing] = useState<Device | null>(null);
  const [open, setOpen] = useState(false);
  const filtered = items.filter((d) => d.device_id.toLowerCase().includes(q.toLowerCase()));
  const fishermanName = (id: string | null) =>
    fishermen.find((f) => f.id === id)?.full_name ?? "Unassigned";
  const now = Date.now();
  useEffect(() => {
    const registry = addHandlers.current;
    registry["devices"] = () => {
      setEditing(null);
      setOpen(true);
    };
    return () => {
      delete registry["devices"];
    };
  });
  return (
    <>
      <SectionHeader
        title="SOS Devices"
        onAdd={() => {
          setEditing(null);
          setOpen(true);
        }}
      />
      <Table
        cols={["Device ID", "Assigned To", "Hardware", "Last Seen", "Status", ""]}
        rows={filtered.map((d) => {
          const lastMs = d.last_seen_at ? Date.now() - new Date(d.last_seen_at).getTime() : null;
          const isStale = lastMs !== null && lastMs > 15 * 60 * 1000;
          return [
            <span className="font-mono text-primary">{d.device_id}</span>,
            <span className={d.fisherman_id ? "text-foreground" : "text-amber-600"}>
              {fishermanName(d.fisherman_id)}
            </span>,
            d.hardware_type ?? "esp32-sim800l",
            d.last_seen_at ? (
              <span className={isStale ? "text-amber-600" : "text-primary"}>
                {new Date(d.last_seen_at).toLocaleString()}
              </span>
            ) : (
              <span className="text-muted-foreground/70">— never —</span>
            ),
            <Badge tone={d.active ? "tide" : "muted"}>{d.active ? "Active" : "Disabled"}</Badge>,
            <RowActions
              onEdit={() => {
                setEditing(d);
                setOpen(true);
              }}
              onDelete={async () => {
                if (!confirm("Delete this device? Its credentials will stop working immediately."))
                  return;
                const { error } = await manageDevice({ action: "delete", id: d.id });
                if (!error) {
                  onChange();
                } else {
                  window.alert(error.message);
                }
              }}
            />,
          ];
        })}
      />
      {open && (
        <DeviceModal
          initial={editing}
          fishermen={fishermen}
          onClose={() => setOpen(false)}
          onSaved={() => {
            setOpen(false);
            onChange();
          }}
        />
      )}
    </>
  );
}

function DeviceModal({
  initial,
  fishermen,
  onClose,
  onSaved,
}: {
  initial: Device | null;
  fishermen: Fisherman[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<Partial<Device>>(
    initial ?? {
      device_id: "DEV-" + Math.random().toString(36).slice(2, 8).toUpperCase(),
      hardware_type: "esp32-sim800l",
      active: true,
    },
  );
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [newSecret, setNewSecret] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    try {
      if (initial) {
        const reason =
          form.active === false
            ? window.prompt("Please provide a reason for disabling this device:")
            : null;
        if (form.active === false && (!reason || reason.trim().length === 0)) {
          window.alert("A reason is required when disabling a device.");
          return;
        }
        const { error } = await manageDevice({
          action: "update",
          id: initial.id,
          deviceId: form.device_id,
          fishermanId: form.fisherman_id ?? null,
          hardwareType: form.hardware_type,
          active: form.active,
          reason: reason ?? null,
        });
        if (error) {
          window.alert(error.message);
        } else {
          onSaved();
        }
      } else {
        if (!form.fisherman_id) {
          window.alert("A device must be assigned to a fisherman before it can be created.");
          return;
        }
        const { data, error } = await manageDevice({
          action: "create",
          deviceId: form.device_id!,
          fishermanId: form.fisherman_id,
          hardwareType: form.hardware_type ?? "esp32-sim800l",
          active: form.active ?? true,
        });

        if (error) {
          window.alert(error.message);
        } else if (data) {
          setNewSecret(data.device_secret);
        }
      }
    } finally {
      setBusy(false);
    }
  }
  async function copy(text: string, label: string) {
    await navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 1200);
  }
  const ingestUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/api/public/ingest/sos`
      : "/api/public/ingest/sos";

  if (newSecret) {
    return (
      <Modal
        title="Device Registered Successfully"
        onClose={() => {
          setNewSecret(null);
          onSaved();
        }}
      >
        <div className="space-y-4 text-sm">
          <div className="rounded-lg border border-amber-300/60 bg-amber-50 p-3 text-xs text-amber-700">
            <strong>Important:</strong> Copy the device secret key now. You will not be able to
            retrieve it again without regenerating it.
          </div>

          <div className="space-y-2">
            <div>
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Device ID
              </div>
              <div className="font-mono text-sm bg-muted px-3 py-2 rounded border border-border text-foreground select-all">
                {form.device_id}
              </div>
            </div>

            <div>
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground flex items-center justify-between">
                <span>Device Secret (x-device-secret header)</span>
                {copied === "secret" && <span className="text-[10px] text-primary">✓ Copied</span>}
              </div>
              <button
                onClick={() => copy(newSecret, "secret")}
                className="w-full text-left font-mono text-xs bg-muted px-3 py-2 rounded border border-border hover:bg-accent transition-colors duration-150 text-primary break-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {newSecret}
              </button>
            </div>

            <div>
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground flex items-center justify-between">
                <span>Ingest Endpoint URL</span>
                {copied === "url" && <span className="text-[10px] text-primary">✓ Copied</span>}
              </div>
              <button
                onClick={() => copy(ingestUrl, "url")}
                className="w-full text-left font-mono text-xs bg-muted px-3 py-2 rounded border border-border hover:bg-accent transition-colors duration-150 text-primary break-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                POST {ingestUrl}
              </button>
            </div>
          </div>

          <div className="mt-5 flex justify-end">
            <button
              onClick={() => {
                setNewSecret(null);
                onSaved();
              }}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors duration-150 hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              Done
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={initial ? "Edit device" : "Register hardware device"} onClose={onClose}>
      <ModalField label="Device ID (printed on hardware label)">
        <Input value={form.device_id ?? ""} onChange={(v) => setForm({ ...form, device_id: v })} />
      </ModalField>
      <ModalField label="Assign to fisherman (required)">
        <Select
          value={form.fisherman_id ?? ""}
          onChange={(v) => setForm({ ...form, fisherman_id: v || null })}
          options={[
            { value: "", label: "— Select fisherman —" },
            ...fishermen.map((f) => ({
              value: f.id,
              label: `${f.full_name}${f.is_certified_captain ? " ⚓" : ""}`,
            })),
          ]}
        />
        {!form.fisherman_id && (
          <div className="mt-1 text-[10px] text-amber-600">
            A device must be assigned to a fisherman before it can be issued.
          </div>
        )}
      </ModalField>
      <ModalField label="Hardware type">
        <Select
          value={form.hardware_type ?? "esp32-sim800l"}
          onChange={(v) => setForm({ ...form, hardware_type: v })}
          options={["esp32-sim800l", "esp32-lora", "other"].map((o) => ({ value: o, label: o }))}
        />
      </ModalField>
      {initial && (
        <div className="space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-3 text-xs">
          <div className="flex items-center justify-between">
            <span className="uppercase tracking-wider text-primary/80">Device credentials</span>
            {copied && <span className="text-[10px] text-primary">✓ {copied} copied</span>}
          </div>
          <div>
            <div className="text-muted-foreground">
              Device secret (<span className="font-mono">x-device-secret</span> header)
            </div>
            <button
              onClick={() => copy(initial.device_secret, "secret")}
              className="mt-1 w-full break-all rounded bg-muted px-2 py-1.5 text-left font-mono text-[11px] text-primary hover:bg-accent transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {initial.device_secret}
            </button>
          </div>
          <div>
            <div className="text-muted-foreground">Ingest endpoint</div>
            <button
              onClick={() => copy(ingestUrl, "url")}
              className="mt-1 w-full break-all rounded bg-muted px-2 py-1.5 text-left font-mono text-[11px] text-primary hover:bg-accent transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              POST {ingestUrl}
            </button>
          </div>
        </div>
      )}
      {!initial && (
        <div className="rounded-lg border border-primary/30 bg-primary/10 p-3 text-xs text-foreground/80">
          <Radio className="mr-1.5 inline h-3.5 w-3.5 text-primary" />A unique device secret is
          generated on save. Credentials will be revealed immediately on success.
        </div>
      )}
      <ModalActions onClose={onClose} onSave={save} busy={busy} />
    </Modal>
  );
}

// ──────────────────── BMUs ────────────────────
function BMUsSection({
  items,
  q,
  onChange,
  addHandlers,
}: {
  items: BMU[];
  q: string;
  onChange: () => void;
  addHandlers: React.MutableRefObject<Record<string, (() => void) | undefined>>;
}) {
  const [editing, setEditing] = useState<BMU | null>(null);
  const [open, setOpen] = useState(false);
  const filtered = items.filter((b) =>
    [b.name, b.region].join(" ").toLowerCase().includes(q.toLowerCase()),
  );
  useEffect(() => {
    const registry = addHandlers.current;
    registry["bmus"] = () => {
      setEditing(null);
      setOpen(true);
    };
    return () => {
      delete registry["bmus"];
    };
  });
  return (
    <>
      <SectionHeader
        title="Beach Management Units"
        onAdd={() => {
          setEditing(null);
          setOpen(true);
        }}
      />
      <Table
        cols={["Name", "Region", "Phone", "Email", ""]}
        rows={filtered.map((b) => [
          <span className="font-medium text-foreground">{b.name}</span>,
          b.region ?? "—",
          b.contact_phone ?? "—",
          b.contact_email ?? "—",
          <RowActions
            onEdit={() => {
              setEditing(b);
              setOpen(true);
            }}
            onDelete={async () => {
              if (!confirm("Delete this BMU?")) return;
              const { error } = await supabase.from("bmus").delete().eq("id", b.id);
              if (error) {
                window.alert(error.message);
              } else {
                onChange();
              }
            }}
          />,
        ])}
      />
      {open && (
        <BMUModal
          initial={editing}
          onClose={() => setOpen(false)}
          onSaved={() => {
            setOpen(false);
            onChange();
          }}
        />
      )}
    </>
  );
}

function BMUModal({
  initial,
  onClose,
  onSaved,
}: {
  initial: BMU | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<Partial<BMU>>(initial ?? { name: "" });
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      const { error } = initial
        ? await supabase.from("bmus").update(form).eq("id", initial.id)
        : await supabase.from("bmus").insert(form as Omit<BMU, "id">);
      if (error) {
        window.alert(error.message);
      } else {
        onSaved();
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={initial ? "Edit BMU" : "New BMU"} onClose={onClose}>
      <ModalField label="Name">
        <Input value={form.name ?? ""} onChange={(v) => setForm({ ...form, name: v })} />
      </ModalField>
      <ModalField label="Region">
        <Input value={form.region ?? ""} onChange={(v) => setForm({ ...form, region: v })} />
      </ModalField>
      <ModalField label="Contact phone">
        <Input
          value={form.contact_phone ?? ""}
          onChange={(v) => setForm({ ...form, contact_phone: v })}
        />
      </ModalField>
      <ModalField label="Contact email">
        <Input
          value={form.contact_email ?? ""}
          onChange={(v) => setForm({ ...form, contact_email: v })}
        />
      </ModalField>
      <ModalActions onClose={onClose} onSave={save} busy={busy} />
    </Modal>
  );
}

// ──────────────────── UI PRIMITIVES ────────────────────
function FilterChip({ label, options }: { label: string; options: string[] }) {
  const [value, setValue] = useState<string>("");
  return (
    <div className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background py-1 pl-3 pr-1.5 text-xs">
      <span className="font-medium text-muted-foreground">{label}</span>
      <select
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="rounded-full bg-muted px-2 py-1 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <option value="">All</option>
        {options.map((o) => (
          <option key={o} value={o} className="bg-white">
            {o}
          </option>
        ))}
      </select>
    </div>
  );
}

function Donut({
  segments,
  size = 132,
  thickness = 16,
  centerLabel,
  centerValue,
}: {
  segments: { value: number; color: string; label: string }[];
  size?: number;
  thickness?: number;
  centerLabel?: string;
  centerValue?: string | number;
}) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--muted)"
          strokeWidth={thickness}
        />
        {segments.map((s, i) => {
          const len = (s.value / total) * circumference;
          const dash = `${len} ${circumference - len}`;
          const el = (
            <circle
              key={i}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={s.color}
              strokeWidth={thickness}
              strokeDasharray={dash}
              strokeDashoffset={-offset}
              strokeLinecap="butt"
            />
          );
          offset += len;
          return el;
        })}
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          {centerValue !== undefined && (
            <div className="text-2xl font-bold leading-none text-foreground">{centerValue}</div>
          )}
          {centerLabel && (
            <div className="mt-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
              {centerLabel}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AnalyticsSidebar({
  fishermen,
  boats,
  devices,
  trips,
}: {
  fishermen: Fisherman[];
  boats: Boat[];
  devices: Device[];
  trips: SeaTrip[];
}) {
  const activeFishermen = fishermen.filter((f) => f.active).length;
  const activeDevices = devices.filter((d) => d.active).length;
  const captains = fishermen.filter((f) => f.is_certified_captain).length;
  const atSea = trips.filter((t) => t.status === "at_sea" || t.status === "sos").length;
  const segments = [
    { value: activeFishermen, color: "var(--tide)", label: "Active" },
    {
      value: fishermen.length - activeFishermen,
      color: "var(--muted-foreground)",
      label: "Inactive",
    },
    { value: captains, color: "var(--chart-2)", label: "Captains" },
  ];

  const metrics = [
    {
      label: "Registered Boats",
      value: boats.length,
      icon: <ShipIcon className="h-4 w-4" />,
      tone: "text-primary",
    },
    {
      label: "Active Devices",
      value: activeDevices,
      icon: <CpuIcon className="h-4 w-4" />,
      tone: "text-tide",
    },
    {
      label: "Trips At Sea",
      value: atSea,
      icon: <Activity className="h-4 w-4" />,
      tone: "text-distress",
    },
    {
      label: "Certified Captains",
      value: captains,
      icon: <UsersIcon className="h-4 w-4" />,
      tone: "text-primary",
    },
  ];

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
          <TrendingUp className="h-3.5 w-3.5 text-primary" /> Fleet Overview
        </div>
        <div className="flex flex-col items-center">
          <Donut segments={segments} centerValue={fishermen.length} centerLabel="Fishermen" />
          <div className="mt-3 flex w-full justify-center gap-3 text-[11px]">
            {segments.map((s, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                <span className="text-muted-foreground">{s.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {metrics.map((m, i) => (
          <div key={i} className="rounded-xl border border-border bg-white p-3 shadow-sm">
            <div className={`mb-1 ${m.tone}`}>{m.icon}</div>
            <div className="text-xl font-bold leading-none text-foreground">{m.value}</div>
            <div className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">
              {m.label}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SectionHeader({ title, onAdd }: { title: string; onAdd?: () => void }) {
  return (
    <div className="mb-4 flex items-center justify-between">
      <h2 className="text-sm font-semibold tracking-wide text-muted-foreground">{title}</h2>
      {onAdd && (
        <button
          onClick={onAdd}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors duration-150 hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <Plus className="h-4 w-4" /> Add
        </button>
      )}
    </div>
  );
}

function Table({ cols, rows }: { cols: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-white">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/50 text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr>
              {cols.map((c, i) => (
                <th key={i} className="px-4 py-2.5 text-left font-medium whitespace-nowrap">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.length === 0 && (
              <tr>
                <td className="px-4 py-10 text-center text-muted-foreground" colSpan={cols.length}>
                  No records yet.
                </td>
              </tr>
            )}
            {rows.map((r, i) => (
              <tr key={i} className="transition-colors duration-150 hover:bg-muted/50">
                {r.map((cell, j) => (
                  <td key={j} className="px-4 py-3 text-foreground/80">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RowActions({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  return (
    <div className="flex justify-end gap-1">
      <button
        onClick={onEdit}
        className="rounded-md p-1.5 text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        title="Edit"
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={onDelete}
        className="rounded-md p-1.5 text-muted-foreground transition-colors duration-150 hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        title="Delete"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function Badge({
  tone,
  children,
}: {
  tone: "tide" | "muted" | "distress" | "warn";
  children: React.ReactNode;
}) {
  const cls =
    tone === "tide"
      ? "bg-primary/10 text-primary"
      : tone === "distress"
        ? "bg-destructive/10 text-destructive"
        : tone === "warn"
          ? "bg-amber-100 text-amber-700"
          : "bg-muted text-muted-foreground";
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${cls}`}
    >
      {children}
    </span>
  );
}

function StatusChip({ tone, children }: { tone: string; children: React.ReactNode }) {
  const cls =
    tone === "distress"
      ? "bg-destructive/10 text-destructive"
      : tone === "warn"
        ? "bg-amber-100 text-amber-700"
        : tone === "tide"
          ? "bg-primary/10 text-primary"
          : "bg-muted text-muted-foreground";
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider transition-colors duration-150 ${cls}`}
    >
      {children}
    </span>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/40 p-4 backdrop-blur-sm">
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl border border-border bg-white p-5 text-foreground shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold">{title}</h3>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-3 overflow-y-auto pr-1">{children}</div>
      </div>
    </div>
  );
}

function ModalField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function ModalActions({
  onClose,
  onSave,
  busy,
}: {
  onClose: () => void;
  onSave: () => void;
  busy: boolean;
}) {
  return (
    <div className="sticky bottom-0 -mx-1 mt-5 flex justify-end gap-2 bg-white px-1 pt-4">
      <button
        onClick={onClose}
        className="rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Cancel
      </button>
      <button
        onClick={onSave}
        disabled={busy}
        className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors duration-150 hover:bg-primary/90 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        {busy ? "Saving…" : "Save"}
      </button>
    </div>
  );
}

function Input({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors duration-150 placeholder:text-muted-foreground/70 focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring"
    />
  );
}

function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors duration-150 focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value} className="bg-white">
          {o.label}
        </option>
      ))}
    </select>
  );
}
