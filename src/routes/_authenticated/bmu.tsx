import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { BMU, Boat, Device, Fisherman, TripStatus } from "@/lib/marine-types";
import { TRIP_STATUS_LABEL, TRIP_STATUS_TONE } from "@/lib/marine-types";
import { requireRole } from "@/lib/route-guard";
import { STAFF_ROLES } from "@/lib/use-role";
import {
  Anchor, Cpu, LifeBuoy, LogOut, Pencil, Plus,
  Radio, Search, Ship, Trash2, Users, X, ClipboardList, Link2,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/bmu")({
  beforeLoad: ({ context }) => requireRole(context as any, ["bmu_officer"]),
  head: () => ({
    meta: [
      { title: "BMU Registration — MarineRescue" },
      { name: "description", content: "Register fishermen, boats, SOS devices and manage sea trips." },
    ],
  }),
  component: BMUDashboard,
});

type Tab = "trips" | "fishermen" | "boats" | "devices" | "bmus";

interface SeaTrip {
  id: string; status: TripStatus; destination: string | null; fishing_area: string | null;
  planned_departure: string | null; actual_departure: string | null;
  expected_return: string | null; actual_return: string | null; notes: string | null;
  captain?: { full_name: string; phone: string | null } | null;
  boat?: { name: string; registration_number: string | null } | null;
}

interface Profile { id: string; full_name: string | null; email: string | null; fisherman_id: string | null; }

function BMUDashboard() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("trips");
  const [bmus, setBMUs] = useState<BMU[]>([]);
  const [fishermen, setFishermen] = useState<Fisherman[]>([]);
  const [boats, setBoats] = useState<Boat[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [trips, setTrips] = useState<SeaTrip[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [q, setQ] = useState("");

  async function refresh() {
    const [bRes, fRes, boRes, dRes, tRes] = await Promise.all([
      supabase.from("bmus").select("*").order("name"),
      supabase.from("fishermen").select("*").order("full_name"),
      supabase.from("boats").select("*").order("name"),
      supabase.from("devices").select("*").order("device_id"),
      supabase.from("sea_trips")
        .select("*, captain:captain_id(full_name,phone), boat:boat_id(name,registration_number)")
        .order("created_at", { ascending: false }).limit(100),
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
    const ch = supabase.channel("bmu-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "sea_trips" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "fishermen" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "devices" }, refresh)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  async function signOut() { await supabase.auth.signOut(); navigate({ to: "/auth" }); }

  return (
    <div className="min-h-screen bg-ocean text-foam">
      <header className="flex items-center justify-between border-b border-foam/10 px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-foam/10 ring-1 ring-foam/15">
            <LifeBuoy className="h-4 w-4 text-distress" />
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-[0.2em] text-foam/50">BMU Console</div>
            <div className="text-sm font-semibold">Registration & Fleet Management</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={signOut} className="inline-flex items-center gap-1.5 rounded-lg border border-foam/15 px-3 py-1.5 text-xs text-foam/80 hover:bg-foam/10">
            <LogOut className="h-3.5 w-3.5" /> Sign out
          </button>
        </div>
      </header>

      <div className="border-b border-foam/10 px-6">
        <nav className="flex gap-1">
          <TabBtn active={tab === "trips"} onClick={() => setTab("trips")}
            icon={<ClipboardList className="h-4 w-4" />} label="Sea Trips"
            count={pendingCount} countTone="warn" />
          <TabBtn active={tab === "fishermen"} onClick={() => setTab("fishermen")}
            icon={<Users className="h-4 w-4" />} label="Fishermen" count={fishermen.length} />
          <TabBtn active={tab === "boats"} onClick={() => setTab("boats")}
            icon={<Ship className="h-4 w-4" />} label="Boats" count={boats.length} />
          <TabBtn active={tab === "devices"} onClick={() => setTab("devices")}
            icon={<Cpu className="h-4 w-4" />} label="Devices" count={devices.length} />
          <TabBtn active={tab === "bmus"} onClick={() => setTab("bmus")}
            icon={<Anchor className="h-4 w-4" />} label="BMUs" count={bmus.length} />
        </nav>
      </div>

      <div className="px-6 py-5">
        <div className="mb-4 flex items-center gap-2">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foam/40" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search records…"
              className="w-full rounded-lg border border-foam/10 bg-foam/[0.04] py-2 pl-9 pr-3 text-sm text-foam outline-none focus:border-tide/60" />
          </div>
        </div>

        {tab === "trips" && <TripsSection items={trips} q={q} onChange={refresh} />}
        {tab === "fishermen" && <FishermenSection items={fishermen} bmus={bmus} q={q} onChange={refresh} />}
        {tab === "boats" && <BoatsSection items={boats} bmus={bmus} fishermen={fishermen} q={q} onChange={refresh} />}
        {tab === "devices" && <DevicesSection items={devices} boats={boats} q={q} onChange={refresh} />}
        {tab === "bmus" && <BMUsSection items={bmus} q={q} onChange={refresh} />}
      </div>
    </div>
  );
}

function TabBtn({ active, onClick, icon, label, count, countTone }: {
  active: boolean; onClick: () => void; icon: React.ReactNode;
  label: string; count: number; countTone?: "warn";
}) {
  const badgeCls = countTone === "warn" && count > 0
    ? "bg-yellow-500/20 text-yellow-300"
    : "bg-foam/10 text-foam/60";
  return (
    <button onClick={onClick}
      className={`-mb-px inline-flex items-center gap-2 border-b-2 px-4 py-3 text-sm transition ${
        active ? "border-tide text-foam" : "border-transparent text-foam/60 hover:text-foam"
      }`}>
      {icon} {label}
      {count > 0 && <span className={`rounded-full px-1.5 text-[10px] ${badgeCls}`}>{count}</span>}
    </button>
  );
}

// ──────────────────── SEA TRIPS APPROVAL QUEUE ────────────────────
function TripsSection({ items, q, onChange }: { items: SeaTrip[]; q: string; onChange: () => void }) {
  const [crewTripId, setCrewTripId] = useState<string | null>(null);

  const filtered = items.filter((t) =>
    [t.captain?.full_name, t.boat?.name, t.destination, t.fishing_area, t.status]
      .join(" ").toLowerCase().includes(q.toLowerCase()),
  );

  const pending = filtered.filter((t) => t.status === "pending_approval");
  const rest = filtered.filter((t) => t.status !== "pending_approval");

  async function approve(id: string) {
    await supabase.from("sea_trips").update({ status: "at_sea", actual_departure: new Date().toISOString() }).eq("id", id);
    onChange();
  }
  async function reject(id: string) {
    await supabase.from("sea_trips").update({ status: "cancelled" }).eq("id", id);
    onChange();
  }
  async function markOverdue(id: string) {
    await supabase.from("sea_trips").update({ status: "overdue" }).eq("id", id);
    onChange();
  }

  return (
    <>
      {pending.length > 0 && (
        <div className="mb-6">
          <div className="mb-3 flex items-center gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-yellow-300">
              Pending Approval ({pending.length})
            </h2>
          </div>
          <div className="space-y-2">
            {pending.map((t) => (
              <div key={t.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-yellow-500/30 bg-yellow-500/5 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold">{t.captain?.full_name ?? "—"}</div>
                  <div className="text-xs text-foam/60">{t.boat?.name ?? "—"} · {t.destination ?? "No destination"}</div>
                  {t.expected_return && (
                    <div className="text-[11px] text-foam/40">
                      Expected return: {new Date(t.expected_return).toLocaleString()}
                    </div>
                  )}
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setCrewTripId(t.id)}
                    className="rounded-lg border border-foam/15 px-2 py-1.5 text-xs hover:bg-foam/10">
                    Crew
                  </button>
                  <button onClick={() => reject(t.id)}
                    className="rounded-lg border border-distress/30 px-3 py-1.5 text-xs text-distress hover:bg-distress/10">
                    Reject
                  </button>
                  <button onClick={() => approve(t.id)}
                    className="rounded-lg bg-tide px-3 py-1.5 text-xs font-semibold text-ocean hover:bg-tide/90">
                    Approve & Dispatch
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <SectionHeader title="All Trips" onAdd={undefined} />
      <div className="overflow-hidden rounded-xl border border-foam/10 bg-foam/[0.02]">
        <table className="w-full text-sm">
          <thead className="border-b border-foam/10 bg-foam/[0.03] text-[11px] uppercase tracking-wider text-foam/50">
            <tr>
              <th className="px-4 py-2 text-left">Captain</th>
              <th className="px-4 py-2 text-left">Boat</th>
              <th className="px-4 py-2 text-left">Status</th>
              <th className="px-4 py-2 text-left">Destination</th>
              <th className="px-4 py-2 text-left">Expected Return</th>
              <th className="px-4 py-2 text-left"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-foam/5">
            {rest.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-foam/40">No trips.</td></tr>}
            {rest.map((t) => {
              const tone = TRIP_STATUS_TONE[t.status];
              const isOverdueable = t.status === "at_sea" && t.expected_return && new Date(t.expected_return) < new Date();
              return (
                <tr key={t.id} className="hover:bg-foam/[0.03]">
                  <td className="px-4 py-3 font-medium">{t.captain?.full_name ?? "—"}</td>
                  <td className="px-4 py-3 text-foam/70">{t.boat?.name ?? "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider ${
                      tone === "distress" ? "bg-distress/15 text-distress"
                      : tone === "warn" ? "bg-yellow-500/15 text-yellow-300"
                      : tone === "tide" ? "bg-tide/15 text-tide"
                      : "bg-foam/10 text-foam/60"
                    }`}>{TRIP_STATUS_LABEL[t.status]}</span>
                  </td>
                  <td className="px-4 py-3 text-foam/70">{t.destination ?? "—"}</td>
                  <td className="px-4 py-3 text-foam/60 text-xs">
                    {t.expected_return ? new Date(t.expected_return).toLocaleString() : "—"}
                    {isOverdueable && <span className="ml-2 text-distress font-semibold">OVERDUE</span>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <button onClick={() => setCrewTripId(t.id)}
                        className="rounded p-1.5 text-foam/60 hover:bg-foam/10 hover:text-foam" title="Manage crew">
                        <Users className="h-3.5 w-3.5" />
                      </button>
                      {isOverdueable && (
                        <button onClick={() => markOverdue(t.id)}
                          className="rounded px-2 py-1 text-[10px] text-distress hover:bg-distress/10">
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

      {crewTripId && (
        <CrewModal tripId={crewTripId} fishermen={[]} onClose={() => setCrewTripId(null)} />
      )}
    </>
  );
}

// ──────────────────── CREW MODAL ────────────────────
function CrewModal({ tripId, fishermen: _ignored, onClose }: {
  tripId: string; fishermen: Fisherman[]; onClose: () => void;
}) {
  const [crew, setCrew] = useState<Array<{ id: string; fisherman_id: string; role: string | null; fisherman?: { full_name: string; phone: string | null } | null }>>([]);
  const [allFishermen, setAllFishermen] = useState<Fisherman[]>([]);
  const [addId, setAddId] = useState("");
  const [addRole, setAddRole] = useState("");
  const [busy, setBusy] = useState(false);

  async function loadCrew() {
    const [{ data: c }, { data: f }] = await Promise.all([
      supabase.from("trip_crew").select("*, fisherman:fisherman_id(full_name,phone)").eq("trip_id", tripId),
      supabase.from("fishermen").select("id,full_name,phone").order("full_name"),
    ]);
    setCrew((c as typeof crew) ?? []);
    setAllFishermen((f as Fisherman[]) ?? []);
  }

  useEffect(() => { loadCrew(); }, [tripId]);

  async function addMember() {
    if (!addId) return;
    setBusy(true);
    await supabase.from("trip_crew").insert({ trip_id: tripId, fisherman_id: addId, role: addRole || null });
    setAddId(""); setAddRole("");
    await loadCrew();
    setBusy(false);
  }

  async function removeMember(id: string) {
    await supabase.from("trip_crew").delete().eq("id", id);
    loadCrew();
  }

  const crewIds = new Set(crew.map((c) => c.fisherman_id));
  const available = allFishermen.filter((f) => !crewIds.has(f.id));

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-2xl border border-foam/15 bg-ocean p-5 text-foam">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold">Trip Crew</h3>
          <button onClick={onClose} className="rounded p-1 text-foam/60 hover:bg-foam/10"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-2 mb-4">
          {crew.length === 0 && <div className="text-sm text-foam/40">No crew members yet.</div>}
          {crew.map((c) => (
            <div key={c.id} className="flex items-center justify-between rounded-lg border border-foam/10 px-3 py-2">
              <div>
                <div className="text-sm font-medium">{c.fisherman?.full_name ?? c.fisherman_id}</div>
                {c.role && <div className="text-[11px] text-foam/50">{c.role}</div>}
              </div>
              <button onClick={() => removeMember(c.id)} className="text-foam/40 hover:text-distress">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
        {available.length > 0 && (
          <div className="space-y-2 border-t border-foam/10 pt-3">
            <div className="text-[11px] uppercase tracking-wider text-foam/50">Add crew member</div>
            <div className="flex gap-2">
              <select value={addId} onChange={(e) => setAddId(e.target.value)}
                className="flex-1 rounded-lg border border-foam/10 bg-foam/[0.04] px-2 py-2 text-sm text-foam outline-none focus:border-tide/60">
                <option value="">Select fisherman</option>
                {available.map((f) => <option key={f.id} value={f.id}>{f.full_name}</option>)}
              </select>
              <input value={addRole} onChange={(e) => setAddRole(e.target.value)} placeholder="Role"
                className="w-28 rounded-lg border border-foam/10 bg-foam/[0.04] px-2 py-2 text-sm text-foam outline-none focus:border-tide/60" />
            </div>
            <button onClick={addMember} disabled={busy || !addId}
              className="rounded-lg bg-tide px-3 py-1.5 text-xs font-semibold text-ocean hover:bg-tide/90 disabled:opacity-60">
              Add
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ──────────────────── FISHERMEN (with profile link) ────────────────────
function FishermenSection({ items, bmus, q, onChange }: {
  items: Fisherman[]; bmus: BMU[]; q: string; onChange: () => void;
}) {
  const [editing, setEditing] = useState<Fisherman | null>(null);
  const [open, setOpen] = useState(false);
  const [linkFisherman, setLinkFisherman] = useState<Fisherman | null>(null);
  const filtered = items.filter((f) =>
    [f.full_name, f.phone, f.national_id].join(" ").toLowerCase().includes(q.toLowerCase()),
  );
  const bmuName = (id: string | null) => bmus.find((b) => b.id === id)?.name ?? "—";

  return (
    <>
      <SectionHeader title="Registered Fishermen" onAdd={() => { setEditing(null); setOpen(true); }} />
      <Table
        cols={["Name", "Phone", "National ID", "BMU", "Emergency", "Status", ""]}
        rows={filtered.map((f) => [
          <span className="font-medium text-foam">{f.full_name}</span>,
          f.phone ?? "—",
          f.national_id ?? "—",
          bmuName(f.bmu_id),
          f.emergency_contact_phone ?? "—",
          <Badge tone={f.active ? "tide" : "muted"}>{f.active ? "Active" : "Inactive"}</Badge>,
          <div className="flex justify-end gap-1">
            <button onClick={() => setLinkFisherman(f)}
              className="rounded p-1.5 text-foam/60 hover:bg-foam/10 hover:text-tide" title="Link to user account">
              <Link2 className="h-3.5 w-3.5" />
            </button>
            <button onClick={() => { setEditing(f); setOpen(true); }}
              className="rounded p-1.5 text-foam/60 hover:bg-foam/10 hover:text-foam">
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button onClick={async () => {
              if (!confirm("Delete this fisherman?")) return;
              await supabase.from("fishermen").delete().eq("id", f.id);
              onChange();
            }} className="rounded p-1.5 text-foam/60 hover:bg-distress/15 hover:text-distress">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>,
        ])}
      />
      {open && (
        <FishermanModal initial={editing} bmus={bmus}
          onClose={() => setOpen(false)} onSaved={() => { setOpen(false); onChange(); }} />
      )}
      {linkFisherman && (
        <LinkProfileModal fisherman={linkFisherman}
          onClose={() => setLinkFisherman(null)} onSaved={() => { setLinkFisherman(null); onChange(); }} />
      )}
    </>
  );
}

function LinkProfileModal({ fisherman, onClose, onSaved }: {
  fisherman: Fisherman; onClose: () => void; onSaved: () => void;
}) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [currentLink, setCurrentLink] = useState<Profile | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([
      // Only show fisherman-role accounts — filter out any staff profile
      supabase.from("profiles").select("id,full_name,email,fisherman_id").order("full_name"),
      supabase.from("profiles").select("id,full_name,email,fisherman_id").eq("fisherman_id", fisherman.id).maybeSingle(),
      supabase.from("user_roles").select("user_id").in("role", STAFF_ROLES),
    ]).then(([{ data: p }, { data: linked }, { data: staff }]) => {
      const staffIds = new Set((staff ?? []).map((r: { user_id: string }) => r.user_id));
      const fishermanProfiles = (p as Profile[] ?? []).filter((prof) => !staffIds.has(prof.id));
      setProfiles(fishermanProfiles);
      setCurrentLink(linked as Profile | null);
      if (linked) setSelectedProfileId((linked as Profile).id);
    });
  }, [fisherman.id]);

  async function save() {
    setBusy(true);
    try {
      if (currentLink && currentLink.id !== selectedProfileId) {
        await supabase.from("profiles").update({ fisherman_id: null }).eq("id", currentLink.id);
      }
      if (selectedProfileId) {
        await supabase.from("profiles").update({ fisherman_id: fisherman.id }).eq("id", selectedProfileId);
      }
      onSaved();
    } finally { setBusy(false); }
  }

  return (
    <Modal title={`Link account → ${fisherman.full_name}`} onClose={onClose}>
      {currentLink && (
        <div className="rounded-lg border border-tide/30 bg-tide/5 px-3 py-2 text-xs text-foam/70">
          Currently linked to <span className="font-semibold text-foam">{currentLink.full_name ?? currentLink.email}</span>
        </div>
      )}
      <ModalField label="User account">
        <Select value={selectedProfileId} onChange={setSelectedProfileId}
          options={[
            { value: "", label: "— Unlink —" },
            ...profiles.map((p) => ({ value: p.id, label: `${p.full_name ?? "—"} (${p.email})` })),
          ]} />
      </ModalField>
      <ModalActions onClose={onClose} onSave={save} busy={busy} />
    </Modal>
  );
}

function FishermanModal({ initial, bmus, onClose, onSaved }: {
  initial: Fisherman | null; bmus: BMU[]; onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState<Partial<Fisherman>>(
    initial ?? { full_name: "", active: true, bmu_id: bmus[0]?.id ?? null },
  );
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      if (initial) await supabase.from("fishermen").update(form).eq("id", initial.id);
      else await supabase.from("fishermen").insert(form as any);
      onSaved();
    } finally { setBusy(false); }
  }
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
          <Input value={form.national_id ?? ""} onChange={(v) => setForm({ ...form, national_id: v })} />
        </ModalField>
      </div>
      <ModalField label="BMU">
        <Select value={form.bmu_id ?? ""} onChange={(v) => setForm({ ...form, bmu_id: v || null })}
          options={[{ value: "", label: "— None —" }, ...bmus.map((b) => ({ value: b.id, label: b.name }))]} />
      </ModalField>
      <div className="grid grid-cols-2 gap-3">
        <ModalField label="Emergency contact name">
          <Input value={form.emergency_contact_name ?? ""} onChange={(v) => setForm({ ...form, emergency_contact_name: v })} />
        </ModalField>
        <ModalField label="Emergency contact phone">
          <Input value={form.emergency_contact_phone ?? ""} onChange={(v) => setForm({ ...form, emergency_contact_phone: v })} />
        </ModalField>
      </div>
      <ModalField label="Photo URL (optional)">
        <Input value={form.photo_url ?? ""} onChange={(v) => setForm({ ...form, photo_url: v })} />
      </ModalField>
      <ModalActions onClose={onClose} onSave={save} busy={busy} />
    </Modal>
  );
}

// ──────────────────── BOATS ────────────────────
function BoatsSection({ items, bmus, fishermen, q, onChange }: {
  items: Boat[]; bmus: BMU[]; fishermen: Fisherman[]; q: string; onChange: () => void;
}) {
  const [editing, setEditing] = useState<Boat | null>(null);
  const [open, setOpen] = useState(false);
  const filtered = items.filter((b) =>
    [b.name, b.registration_number, b.boat_type].join(" ").toLowerCase().includes(q.toLowerCase()),
  );
  const fishName = (id: string | null) => fishermen.find((f) => f.id === id)?.full_name ?? "—";
  const bmuName = (id: string | null) => bmus.find((b) => b.id === id)?.name ?? "—";
  return (
    <>
      <SectionHeader title="Registered Boats" onAdd={() => { setEditing(null); setOpen(true); }} />
      <Table cols={["Name", "Reg. No.", "Type", "Owner", "BMU", ""]}
        rows={filtered.map((b) => [
          <span className="font-medium text-foam">{b.name}</span>,
          b.registration_number ?? "—", b.boat_type ?? "—",
          fishName(b.owner_fisherman_id), bmuName(b.bmu_id),
          <RowActions onEdit={() => { setEditing(b); setOpen(true); }}
            onDelete={async () => {
              if (!confirm("Delete this boat?")) return;
              await supabase.from("boats").delete().eq("id", b.id); onChange();
            }} />,
        ])} />
      {open && <BoatModal initial={editing} bmus={bmus} fishermen={fishermen}
        onClose={() => setOpen(false)} onSaved={() => { setOpen(false); onChange(); }} />}
    </>
  );
}

function BoatModal({ initial, bmus, fishermen, onClose, onSaved }: {
  initial: Boat | null; bmus: BMU[]; fishermen: Fisherman[]; onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState<Partial<Boat>>(initial ?? { name: "", boat_type: "Trawler" });
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      if (initial) await supabase.from("boats").update(form).eq("id", initial.id);
      else await supabase.from("boats").insert(form as any);
      onSaved();
    } finally { setBusy(false); }
  }
  return (
    <Modal title={initial ? "Edit boat" : "New boat"} onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <ModalField label="Boat name">
          <Input value={form.name ?? ""} onChange={(v) => setForm({ ...form, name: v })} />
        </ModalField>
        <ModalField label="Registration number">
          <Input value={form.registration_number ?? ""} onChange={(v) => setForm({ ...form, registration_number: v })} />
        </ModalField>
      </div>
      <ModalField label="Boat type">
        <Select value={form.boat_type ?? "Trawler"} onChange={(v) => setForm({ ...form, boat_type: v })}
          options={["Trawler", "Canoe", "Skiff", "Long-liner", "Other"].map((o) => ({ value: o, label: o }))} />
      </ModalField>
      <ModalField label="Owner (fisherman)">
        <Select value={form.owner_fisherman_id ?? ""} onChange={(v) => setForm({ ...form, owner_fisherman_id: v || null })}
          options={[{ value: "", label: "— None —" }, ...fishermen.map((f) => ({ value: f.id, label: f.full_name }))]} />
      </ModalField>
      <ModalField label="BMU">
        <Select value={form.bmu_id ?? ""} onChange={(v) => setForm({ ...form, bmu_id: v || null })}
          options={[{ value: "", label: "— None —" }, ...bmus.map((b) => ({ value: b.id, label: b.name }))]} />
      </ModalField>
      <ModalActions onClose={onClose} onSave={save} busy={busy} />
    </Modal>
  );
}

// ──────────────────── DEVICES ────────────────────
function DevicesSection({ items, boats, q, onChange }: {
  items: Device[]; boats: Boat[]; q: string; onChange: () => void;
}) {
  const [editing, setEditing] = useState<Device | null>(null);
  const [open, setOpen] = useState(false);
  const filtered = items.filter((d) => d.device_id.toLowerCase().includes(q.toLowerCase()));
  const boatName = (id: string | null) => boats.find((b) => b.id === id)?.name ?? "Unassigned";
  const now = Date.now();
  return (
    <>
      <SectionHeader title="SOS Devices" onAdd={() => { setEditing(null); setOpen(true); }} />
      <Table cols={["Device ID", "Assigned Boat", "Hardware", "Last Seen", "Status", ""]}
        rows={filtered.map((d) => {
          const lastMs = d.last_seen_at ? Date.now() - new Date(d.last_seen_at).getTime() : null;
          const isStale = lastMs !== null && lastMs > 15 * 60 * 1000;
          return [
            <span className="font-mono text-tide">{d.device_id}</span>,
            boatName(d.boat_id),
            d.hardware_type ?? "esp32-sim7600",
            d.last_seen_at
              ? <span className={isStale ? "text-yellow-400" : "text-tide"}>
                  {new Date(d.last_seen_at).toLocaleString()}
                </span>
              : <span className="text-foam/40">— never —</span>,
            <Badge tone={d.active ? "tide" : "muted"}>{d.active ? "Active" : "Disabled"}</Badge>,
            <RowActions onEdit={() => { setEditing(d); setOpen(true); }}
              onDelete={async () => {
                if (!confirm("Delete this device? Its credentials will stop working immediately.")) return;
                await supabase.from("devices").delete().eq("id", d.id); onChange();
              }} />,
          ];
        })} />
      {open && <DeviceModal initial={editing} boats={boats}
        onClose={() => setOpen(false)} onSaved={() => { setOpen(false); onChange(); }} />}
    </>
  );
}

function DeviceModal({ initial, boats, onClose, onSaved }: {
  initial: Device | null; boats: Boat[]; onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState<Partial<Device>>(
    initial ?? { device_id: "DEV-" + Math.random().toString(36).slice(2, 8).toUpperCase(), hardware_type: "esp32-sim7600", active: true },
  );
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    try {
      if (initial) {
        await supabase.from("devices").update({
          device_id: form.device_id, boat_id: form.boat_id ?? null,
          hardware_type: form.hardware_type, active: form.active,
        }).eq("id", initial.id);
      } else {
        await supabase.from("devices").insert({
          device_id: form.device_id!, boat_id: form.boat_id ?? null,
          hardware_type: form.hardware_type ?? "esp32-sim7600", active: form.active ?? true,
        } as any);
      }
      onSaved();
    } finally { setBusy(false); }
  }
  async function copy(text: string, label: string) {
    await navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 1200);
  }
  const ingestUrl = typeof window !== "undefined" ? `${window.location.origin}/api/public/ingest/sos` : "/api/public/ingest/sos";
  return (
    <Modal title={initial ? "Edit device" : "Register hardware device"} onClose={onClose}>
      <ModalField label="Device ID (printed on hardware label)">
        <Input value={form.device_id ?? ""} onChange={(v) => setForm({ ...form, device_id: v })} />
      </ModalField>
      <ModalField label="Assign to boat">
        <Select value={form.boat_id ?? ""} onChange={(v) => setForm({ ...form, boat_id: v || null })}
          options={[{ value: "", label: "— Unassigned —" }, ...boats.map((b) => ({ value: b.id, label: b.name }))]} />
      </ModalField>
      <ModalField label="Hardware type">
        <Select value={form.hardware_type ?? "esp32-sim7600"} onChange={(v) => setForm({ ...form, hardware_type: v })}
          options={["esp32-sim7600", "esp32-lora", "other"].map((o) => ({ value: o, label: o }))} />
      </ModalField>
      {initial && (
        <div className="space-y-2 rounded-lg border border-tide/30 bg-tide/5 p-3 text-xs">
          <div className="flex items-center justify-between">
            <span className="uppercase tracking-wider text-tide/80">Device credentials</span>
            {copied && <span className="text-[10px] text-tide">✓ {copied} copied</span>}
          </div>
          <div>
            <div className="text-foam/50">Device secret (<span className="font-mono">x-device-secret</span> header)</div>
            <button onClick={() => copy(initial.device_secret, "secret")}
              className="mt-1 w-full break-all rounded bg-ocean/60 px-2 py-1.5 text-left font-mono text-[11px] text-tide hover:bg-ocean">
              {initial.device_secret}
            </button>
          </div>
          <div>
            <div className="text-foam/50">Ingest endpoint</div>
            <button onClick={() => copy(ingestUrl, "url")}
              className="mt-1 w-full break-all rounded bg-ocean/60 px-2 py-1.5 text-left font-mono text-[11px] text-tide hover:bg-ocean">
              POST {ingestUrl}
            </button>
          </div>
        </div>
      )}
      {!initial && (
        <div className="rounded-lg border border-tide/30 bg-tide/10 p-3 text-xs text-foam/80">
          <Radio className="mr-1.5 inline h-3.5 w-3.5 text-tide" />
          A unique device secret is generated on save. Reopen to reveal and copy into firmware.
        </div>
      )}
      <ModalActions onClose={onClose} onSave={save} busy={busy} />
    </Modal>
  );
}

// ──────────────────── BMUs ────────────────────
function BMUsSection({ items, q, onChange }: { items: BMU[]; q: string; onChange: () => void }) {
  const [editing, setEditing] = useState<BMU | null>(null);
  const [open, setOpen] = useState(false);
  const filtered = items.filter((b) => [b.name, b.region].join(" ").toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <SectionHeader title="Beach Management Units" onAdd={() => { setEditing(null); setOpen(true); }} />
      <Table cols={["Name", "Region", "Phone", "Email", ""]}
        rows={filtered.map((b) => [
          <span className="font-medium text-foam">{b.name}</span>,
          b.region ?? "—", b.contact_phone ?? "—", b.contact_email ?? "—",
          <RowActions onEdit={() => { setEditing(b); setOpen(true); }}
            onDelete={async () => {
              if (!confirm("Delete this BMU?")) return;
              await supabase.from("bmus").delete().eq("id", b.id); onChange();
            }} />,
        ])} />
      {open && <BMUModal initial={editing} onClose={() => setOpen(false)} onSaved={() => { setOpen(false); onChange(); }} />}
    </>
  );
}

function BMUModal({ initial, onClose, onSaved }: { initial: BMU | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<Partial<BMU>>(initial ?? { name: "" });
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      if (initial) await supabase.from("bmus").update(form).eq("id", initial.id);
      else await supabase.from("bmus").insert(form as any);
      onSaved();
    } finally { setBusy(false); }
  }
  return (
    <Modal title={initial ? "Edit BMU" : "New BMU"} onClose={onClose}>
      <ModalField label="Name"><Input value={form.name ?? ""} onChange={(v) => setForm({ ...form, name: v })} /></ModalField>
      <ModalField label="Region"><Input value={form.region ?? ""} onChange={(v) => setForm({ ...form, region: v })} /></ModalField>
      <ModalField label="Contact phone"><Input value={form.contact_phone ?? ""} onChange={(v) => setForm({ ...form, contact_phone: v })} /></ModalField>
      <ModalField label="Contact email"><Input value={form.contact_email ?? ""} onChange={(v) => setForm({ ...form, contact_email: v })} /></ModalField>
      <ModalActions onClose={onClose} onSave={save} busy={busy} />
    </Modal>
  );
}

// ──────────────────── UI PRIMITIVES ────────────────────
function SectionHeader({ title, onAdd }: { title: string; onAdd?: () => void }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-foam/70">{title}</h2>
      {onAdd && (
        <button onClick={onAdd}
          className="inline-flex items-center gap-1.5 rounded-lg bg-tide px-3 py-1.5 text-xs font-semibold text-ocean hover:bg-tide/90">
          <Plus className="h-3.5 w-3.5" /> Add
        </button>
      )}
    </div>
  );
}

function Table({ cols, rows }: { cols: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="overflow-hidden rounded-xl border border-foam/10 bg-foam/[0.02]">
      <table className="w-full text-sm">
        <thead className="border-b border-foam/10 bg-foam/[0.03] text-[11px] uppercase tracking-wider text-foam/50">
          <tr>{cols.map((c, i) => <th key={i} className="px-4 py-2 text-left font-medium">{c}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-foam/5">
          {rows.length === 0 && <tr><td className="px-4 py-10 text-center text-foam/40" colSpan={cols.length}>No records yet.</td></tr>}
          {rows.map((r, i) => (
            <tr key={i} className="hover:bg-foam/[0.03]">
              {r.map((cell, j) => <td key={j} className="px-4 py-3 text-foam/80">{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RowActions({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  return (
    <div className="flex justify-end gap-1">
      <button onClick={onEdit} className="rounded p-1.5 text-foam/60 hover:bg-foam/10 hover:text-foam">
        <Pencil className="h-3.5 w-3.5" />
      </button>
      <button onClick={onDelete} className="rounded p-1.5 text-foam/60 hover:bg-distress/15 hover:text-distress">
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function Badge({ tone, children }: { tone: "tide" | "muted" | "distress" | "warn"; children: React.ReactNode }) {
  const cls = tone === "tide" ? "bg-tide/15 text-tide"
    : tone === "distress" ? "bg-distress/15 text-distress"
    : tone === "warn" ? "bg-yellow-500/15 text-yellow-300"
    : "bg-foam/10 text-foam/60";
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider ${cls}`}>{children}</span>;
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
      <div className="w-full max-w-lg rounded-2xl border border-foam/15 bg-ocean p-5 text-foam">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold">{title}</h3>
          <button onClick={onClose} className="rounded p-1 text-foam/60 hover:bg-foam/10"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-3">{children}</div>
      </div>
    </div>
  );
}

function ModalField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[11px] uppercase tracking-wider text-foam/50">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function ModalActions({ onClose, onSave, busy }: { onClose: () => void; onSave: () => void; busy: boolean }) {
  return (
    <div className="mt-5 flex justify-end gap-2">
      <button onClick={onClose} className="rounded-lg border border-foam/15 px-3 py-2 text-sm text-foam/80 hover:bg-foam/10">Cancel</button>
      <button onClick={onSave} disabled={busy} className="rounded-lg bg-tide px-4 py-2 text-sm font-semibold text-ocean hover:bg-tide/90 disabled:opacity-60">
        {busy ? "Saving…" : "Save"}
      </button>
    </div>
  );
}

function Input({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input value={value} onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-lg border border-foam/10 bg-foam/[0.04] px-3 py-2 text-sm text-foam outline-none focus:border-tide/60" />
  );
}

function Select({ value, onChange, options }: {
  value: string; onChange: (v: string) => void; options: { value: string; label: string }[];
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-lg border border-foam/10 bg-foam/[0.04] px-3 py-2 text-sm text-foam outline-none focus:border-tide/60">
      {options.map((o) => <option key={o.value} value={o.value} className="bg-ocean">{o.label}</option>)}
    </select>
  );
}
