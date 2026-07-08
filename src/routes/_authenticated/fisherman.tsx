import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  TRIP_STATUS_LABEL,
  TRIP_STATUS_TONE,
  type TripStatus,
  type SOSAlertRow,
} from "@/lib/marine-types";
import { requireRole, type RouteContext } from "@/lib/route-guard";
import { Anchor, LogOut, Ship, Radio, LifeBuoy, LogIn, Users } from "lucide-react";

export const Route = createFileRoute("/_authenticated/fisherman")({
  ssr: false,
  beforeLoad: ({ context }) => requireRole(context as RouteContext, ["fisherman"]),
  head: () => ({
    meta: [
      { title: "Fisherman Portal — MarineRescue" },
      { name: "description", content: "Your boat, device, and sea trips." },
    ],
  }),
  component: FishermanPortal,
});

interface Profile {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  fisherman_id: string | null;
  bmu_id: string | null;
}
interface FishermanFull {
  id: string;
  full_name: string;
  phone: string | null;
  national_id: string | null;
  bmu_id: string | null;
  bmu?: { name: string } | null;
}
interface BoatRow {
  id: string;
  name: string;
  registration_number: string | null;
  boat_type: string | null;
}
interface DeviceRow {
  id: string;
  device_id: string;
  last_seen_at: string | null;
  active: boolean;
}
interface CrewMember {
  id: string;
  fisherman_id: string;
  role: string | null;
  fisherman?: { full_name: string } | null;
}
interface Trip {
  id: string;
  status: TripStatus;
  planned_departure: string | null;
  actual_departure: string | null;
  expected_return: string | null;
  actual_return: string | null;
  fishing_area: string | null;
  destination: string | null;
  notes: string | null;
  boat?: BoatRow | null;
  crew?: CrewMember[];
}

function FishermanPortal() {
  const navigate = useNavigate();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [fisherman, setFisherman] = useState<FishermanFull | null>(null);
  const [boat, setBoat] = useState<BoatRow | null>(null);
  const [device, setDevice] = useState<DeviceRow | null>(null);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    destination: "",
    fishing_area: "",
    expected_return: "",
    notes: "",
  });
  const [detailTrip, setDetailTrip] = useState<Trip | null>(null);
  const [activeAlert, setActiveAlert] = useState<SOSAlertRow | null>(null);
  const [allFishermen, setAllFishermen] = useState<FishermanFull[]>([]);
  const [selectedCrew, setSelectedCrew] = useState<string[]>([]);

  async function load() {
    const { data: userRes } = await supabase.auth.getUser();
    if (!userRes.user) return;
    const { data: prof } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userRes.user.id)
      .maybeSingle();
    setProfile(prof as Profile);
    if (!prof?.fisherman_id) return;
    const [
      { data: fm },
      { data: bts },
      { data: dvs },
      { data: trs },
      { data: alts },
      { data: allFm },
    ] = await Promise.all([
      supabase
        .from("fishermen")
        .select("*, bmu:bmu_id(name)")
        .eq("id", prof.fisherman_id)
        .maybeSingle(),
      supabase.from("boats").select("*").eq("owner_fisherman_id", prof.fisherman_id).limit(1),
      supabase
        .from("devices")
        .select("*, boats!inner(owner_fisherman_id)")
        .eq("boats.owner_fisherman_id", prof.fisherman_id)
        .limit(1),
      supabase
        .from("sea_trips")
        .select(
          "*, boat:boat_id(id,name,registration_number,boat_type), crew:trip_crew(id,fisherman_id,role,fisherman:fisherman_id(full_name))",
        )
        .eq("captain_id", prof.fisherman_id)
        .order("created_at", { ascending: false })
        .limit(30),
      supabase
        .from("sos_alerts")
        .select("*")
        .eq("fisherman_id", prof.fisherman_id)
        .in("status", ["new", "acknowledged", "assigned", "in_progress"])
        .order("started_at", { ascending: false })
        .limit(1),
      supabase
        .from("fishermen")
        .select("id, full_name, phone")
        .eq("active", true)
        .neq("id", prof.fisherman_id)
        .order("full_name"),
    ]);
    setFisherman(fm as FishermanFull);
    setBoat((bts?.[0] as BoatRow) ?? null);
    setDevice((dvs?.[0] as DeviceRow) ?? null);
    setTrips((trs as Trip[]) ?? []);
    setActiveAlert((alts?.[0] as unknown as SOSAlertRow) ?? null);
    setAllFishermen((allFm as FishermanFull[]) ?? []);
  }

  useEffect(() => {
    load();
    // Realtime: live trip status changes
    let fishermanId: string | null = null;
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) return;
      supabase
        .from("profiles")
        .select("fisherman_id")
        .eq("id", data.user.id)
        .maybeSingle()
        .then(({ data: prof }) => {
          fishermanId = (prof as { fisherman_id: string | null } | null)?.fisherman_id ?? null;
          if (!fishermanId) return;
          const ch = supabase
            .channel("fisherman-trips")
            .on("postgres_changes", { event: "*", schema: "public", table: "sea_trips" }, load)
            .on("postgres_changes", { event: "*", schema: "public", table: "sos_alerts" }, load)
            .subscribe();
          return () => {
            supabase.removeChannel(ch);
          };
        });
    });
  }, []);

  const activeTrip = trips.find(
    (t) => t.status === "at_sea" || t.status === "checked_out" || t.status === "pending_approval",
  );

  async function triggerSoftwareSos() {
    if (!profile?.fisherman_id || !device) return;
    setBusy(true);
    try {
      navigator.geolocation.getCurrentPosition(
        async (position) => {
          const lat = position.coords.latitude;
          const lng = position.coords.longitude;
          const accuracy = position.coords.accuracy;

          const { data: alertData, error: alertErr } = await supabase
            .from("sos_alerts")
            .insert({
              device_id: device.id,
              boat_id: boat?.id ?? null,
              fisherman_id: profile.fisherman_id,
              bmu_id: fisherman?.bmu_id ?? null,
              status: "new",
              last_lat: lat,
              last_lng: lng,
              last_accuracy: accuracy,
              last_ping_at: new Date().toISOString(),
              notes: "Triggered via software client on mobile/web portal",
              emergency_level: "HIGH",
            })
            .select("id")
            .single();

          if (alertErr) {
            alert(alertErr.message);
          } else if (alertData) {
            await supabase.from("gps_logs").insert({
              alert_id: alertData.id,
              device_id: device.id,
              lat,
              lng,
              accuracy,
            });

            if (activeTrip) {
              await supabase.from("sea_trips").update({ status: "sos" }).eq("id", activeTrip.id);
            }
            await load();
          }
          setBusy(false);
        },
        (error) => {
          alert("Error getting GPS location: " + error.message);
          setBusy(false);
        },
        { enableHighAccuracy: true },
      );
    } catch (e) {
      alert(String(e));
      setBusy(false);
    }
  }

  async function cancelSoftwareSos() {
    if (!activeAlert) return;
    setBusy(true);
    try {
      await supabase
        .from("sos_alerts")
        .update({ status: "closed", resolved_at: new Date().toISOString() })
        .eq("id", activeAlert.id);

      if (activeTrip) {
        await supabase.from("sea_trips").update({ status: "at_sea" }).eq("id", activeTrip.id);
      }
      await load();
    } catch (e) {
      alert(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function checkOut() {
    if (!profile?.fisherman_id) return;
    if (form.expected_return) {
      const returnDate = new Date(form.expected_return);
      if (returnDate < new Date()) {
        alert("Expected return date cannot be in the past!");
        return;
      }
    }
    setBusy(true);
    try {
      const { data: trip, error: tripErr } = await supabase
        .from("sea_trips")
        .insert({
          captain_id: profile.fisherman_id,
          boat_id: boat?.id ?? null,
          device_id: device?.id ?? null,
          bmu_id: fisherman?.bmu_id ?? null,
          status: "pending_approval",
          planned_departure: new Date().toISOString(),
          expected_return: form.expected_return
            ? new Date(form.expected_return).toISOString()
            : null,
          destination: form.destination || null,
          fishing_area: form.fishing_area || null,
          notes: form.notes || null,
        })
        .select("id")
        .single();

      if (tripErr) {
        alert(tripErr.message);
      } else if (trip && selectedCrew.length > 0) {
        const crewInserts = selectedCrew.map((crewId) => ({
          trip_id: trip.id,
          fisherman_id: crewId,
          role: "Crew",
        }));
        await supabase.from("trip_crew").insert(crewInserts);
      }
      setForm({ destination: "", fishing_area: "", expected_return: "", notes: "" });
      setSelectedCrew([]);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function checkIn(tripId: string) {
    setBusy(true);
    try {
      await supabase
        .from("sea_trips")
        .update({ status: "returned", actual_return: new Date().toISOString() })
        .eq("id", tripId);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/auth" });
  }

  const tripTone = (s: TripStatus) => TRIP_STATUS_TONE[s];

  return (
    <div className="min-h-screen bg-ocean text-foam">
      <header className="flex items-center justify-between border-b border-foam/10 px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-tide/20 ring-1 ring-tide/30">
            <LifeBuoy className="h-4 w-4 text-tide" />
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-[0.2em] text-foam/50">Fisherman</div>
            <div className="text-sm font-semibold">{profile?.full_name ?? "Portal"}</div>
          </div>
        </div>
        <button
          onClick={signOut}
          className="inline-flex items-center gap-1.5 rounded-lg border border-foam/15 px-3 py-1.5 text-xs hover:bg-foam/10"
        >
          <LogOut className="h-3.5 w-3.5" /> Sign out
        </button>
      </header>

      <div className="mx-auto max-w-5xl px-6 py-8">
        {activeAlert && (
          <div className="mb-6 rounded-2xl border border-distress/40 bg-distress/15 p-6 animate-pulse">
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-lg bg-distress/35">
                <Radio className="h-5 w-5 text-foam animate-bounce" />
              </span>
              <div className="flex-1">
                <div className="text-sm font-semibold uppercase tracking-wider text-distress">
                  EMERGENCY SOS DISTRESS ACTIVE
                </div>
                <p className="mt-1 text-xs text-foam/80">
                  A distress signal has been sent to the rescue coordination command center. They
                  are tracking your live GPS location.
                </p>
              </div>
              <button
                onClick={cancelSoftwareSos}
                disabled={busy}
                className="rounded-lg bg-foam px-4 py-2 text-xs font-semibold text-distress hover:bg-foam/90 disabled:opacity-60 transition"
              >
                Cancel SOS
              </button>
            </div>
          </div>
        )}

        {!profile?.fisherman_id ? (
          <div className="rounded-2xl border border-yellow-500/30 bg-yellow-500/5 p-6">
            <div className="text-sm font-semibold text-yellow-300">
              Account not linked to a fisherman record
            </div>
            <p className="mt-2 text-sm text-foam/70">
              Your BMU officer needs to link your account to your fisherman registration in the BMU
              console.
            </p>
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-3">
            <Panel label="Assigned Boat" icon={<Ship className="h-4 w-4 text-tide" />}>
              {boat ? (
                <>
                  <div className="text-lg font-semibold">{boat.name}</div>
                  <div className="mt-1 text-xs text-foam/60">{boat.boat_type ?? "—"}</div>
                  {boat.registration_number && (
                    <div className="mt-1 font-mono text-[11px] text-foam/40">
                      {boat.registration_number}
                    </div>
                  )}
                </>
              ) : (
                <div className="text-sm text-foam/50">No boat assigned</div>
              )}
            </Panel>
            <Panel label="SOS Device" icon={<Radio className="h-4 w-4 text-distress" />}>
              {device ? (
                <>
                  <div className="font-mono text-sm">{device.device_id}</div>
                  <div className="mt-1 inline-flex items-center gap-1.5 text-[11px] text-foam/60">
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        device.last_seen_at &&
                        Date.now() - new Date(device.last_seen_at).getTime() < 900_000
                          ? "bg-tide"
                          : "bg-foam/30"
                      }`}
                    />
                    {device.last_seen_at
                      ? new Date(device.last_seen_at).toLocaleString()
                      : "never seen"}
                  </div>
                  {activeTrip && activeTrip.status === "at_sea" && (
                    <div className="mt-3">
                      {activeAlert ? (
                        <button
                          onClick={cancelSoftwareSos}
                          disabled={busy}
                          className="w-full rounded bg-foam py-1.5 text-xs font-bold uppercase tracking-wider text-distress hover:bg-foam/90 transition disabled:opacity-50"
                        >
                          Cancel SOS
                        </button>
                      ) : (
                        <button
                          onClick={triggerSoftwareSos}
                          disabled={busy}
                          className="w-full rounded bg-distress py-1.5 text-xs font-bold uppercase tracking-wider text-foam hover:bg-distress/90 transition disabled:opacity-50"
                        >
                          🆘 Software SOS
                        </button>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <div className="text-sm text-foam/50">No device assigned</div>
              )}
            </Panel>
            <Panel label="BMU" icon={<Anchor className="h-4 w-4 text-foam" />}>
              <div className="text-lg font-semibold">{fisherman?.bmu?.name ?? "—"}</div>
              <div className="mt-1 text-xs text-foam/60">{fisherman?.national_id ?? ""}</div>
            </Panel>
          </div>
        )}

        {profile?.fisherman_id && (
          <div className="mt-8">
            {activeTrip ? (
              <div
                className={`rounded-2xl border p-6 ${
                  activeTrip.status === "pending_approval"
                    ? "border-yellow-500/30 bg-yellow-500/5"
                    : activeTrip.status === "at_sea"
                      ? "border-tide/30 bg-tide/10"
                      : "border-foam/10 bg-foam/[0.03]"
                }`}
              >
                <div
                  className={`text-[11px] uppercase tracking-wider ${
                    activeTrip.status === "pending_approval"
                      ? "text-yellow-300"
                      : activeTrip.status === "at_sea"
                        ? "text-tide"
                        : "text-foam/60"
                  }`}
                >
                  Current trip · {TRIP_STATUS_LABEL[activeTrip.status]}
                </div>
                <div className="mt-2 text-lg font-semibold">
                  {activeTrip.destination ?? "At sea"}
                </div>
                <div className="mt-1 text-sm text-foam/70">
                  Departed:{" "}
                  {activeTrip.actual_departure
                    ? new Date(activeTrip.actual_departure).toLocaleString()
                    : "Pending"}
                </div>
                <div className="text-sm text-foam/70">
                  Expected return:{" "}
                  {activeTrip.expected_return
                    ? new Date(activeTrip.expected_return).toLocaleString()
                    : "—"}
                </div>

                {activeTrip.crew && activeTrip.crew.length > 0 && (
                  <div className="mt-3 flex items-center gap-2 text-xs text-foam/60">
                    <Users className="h-3.5 w-3.5" />
                    Crew: {activeTrip.crew.map((c) => c.fisherman?.full_name ?? "—").join(", ")}
                  </div>
                )}

                {activeTrip.status === "pending_approval" ? (
                  <div className="mt-4 text-xs text-yellow-300/80">
                    Waiting for BMU officer approval before departure.
                  </div>
                ) : (
                  <button
                    onClick={() => checkIn(activeTrip.id)}
                    disabled={busy}
                    className="mt-4 inline-flex items-center gap-2 rounded-lg bg-tide px-4 py-2 text-sm font-semibold text-ocean hover:bg-tide/90 disabled:opacity-60"
                  >
                    <LogIn className="h-4 w-4" /> Check in — I'm back
                  </button>
                )}
              </div>
            ) : (
              <div className="rounded-2xl border border-foam/10 bg-foam/[0.03] p-6">
                <div className="text-sm font-semibold">Request a new trip</div>
                <p className="mt-1 text-xs text-foam/50">
                  Submitted to your BMU officer for approval before departure.
                </p>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <Field
                    label="Destination"
                    value={form.destination}
                    onChange={(v) => setForm({ ...form, destination: v })}
                  />
                  <Field
                    label="Fishing area"
                    value={form.fishing_area}
                    onChange={(v) => setForm({ ...form, fishing_area: v })}
                  />
                  <Field
                    label="Expected return"
                    type="datetime-local"
                    value={form.expected_return}
                    onChange={(v) => setForm({ ...form, expected_return: v })}
                  />
                  <Field
                    label="Notes"
                    value={form.notes}
                    onChange={(v) => setForm({ ...form, notes: v })}
                  />

                  {allFishermen.length > 0 && (
                    <div className="sm:col-span-2">
                      <span className="text-[11px] uppercase tracking-wider text-foam/50">
                        Select Crew Members
                      </span>
                      <div className="mt-1.5 grid grid-cols-2 gap-2 max-h-36 overflow-y-auto rounded-lg border border-foam/10 bg-ocean/40 p-3">
                        {allFishermen.map((f) => {
                          const isChecked = selectedCrew.includes(f.id);
                          return (
                            <label
                              key={f.id}
                              className="flex items-center gap-2 text-xs text-foam/80 hover:text-foam cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setSelectedCrew([...selectedCrew, f.id]);
                                  } else {
                                    setSelectedCrew(selectedCrew.filter((id) => id !== f.id));
                                  }
                                }}
                                className="rounded border-foam/20 text-tide focus:ring-tide bg-ocean"
                              />
                              {f.full_name}
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
                <button
                  onClick={checkOut}
                  disabled={busy}
                  className="mt-4 rounded-lg bg-distress px-4 py-2 text-sm font-semibold text-foam hover:bg-distress/90 disabled:opacity-60"
                >
                  Submit trip request
                </button>
              </div>
            )}
          </div>
        )}

        <div className="mt-8">
          <div className="mb-3 text-sm font-semibold">Trip history</div>
          <div className="overflow-hidden rounded-2xl border border-foam/10">
            <table className="w-full text-left text-xs">
              <thead className="bg-foam/[0.04] text-[10px] uppercase tracking-wider text-foam/50">
                <tr>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">Destination</th>
                  <th className="px-4 py-2">Departed</th>
                  <th className="px-4 py-2">Returned</th>
                  <th className="px-4 py-2">Crew</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-foam/5">
                {trips.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-foam/50">
                      No trips yet
                    </td>
                  </tr>
                )}
                {trips.map((t) => {
                  const tone = tripTone(t.status);
                  return (
                    <tr
                      key={t.id}
                      className="hover:bg-foam/[0.03] cursor-pointer"
                      onClick={() => setDetailTrip(t)}
                    >
                      <td className="px-4 py-2">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider ${
                            tone === "distress"
                              ? "bg-distress/15 text-distress"
                              : tone === "warn"
                                ? "bg-yellow-500/15 text-yellow-300"
                                : tone === "tide"
                                  ? "bg-tide/15 text-tide"
                                  : "bg-foam/10 text-foam/60"
                          }`}
                        >
                          {TRIP_STATUS_LABEL[t.status]}
                        </span>
                      </td>
                      <td className="px-4 py-2">{t.destination ?? "—"}</td>
                      <td className="px-4 py-2">
                        {t.actual_departure ? new Date(t.actual_departure).toLocaleString() : "—"}
                      </td>
                      <td className="px-4 py-2">
                        {t.actual_return ? new Date(t.actual_return).toLocaleString() : "—"}
                      </td>
                      <td className="px-4 py-2 text-foam/50">{t.crew?.length ?? 0}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {detailTrip && <TripDetailModal trip={detailTrip} onClose={() => setDetailTrip(null)} />}
    </div>
  );
}

function TripDetailModal({ trip, onClose }: { trip: Trip; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-2xl border border-foam/15 bg-ocean p-5 text-foam">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold">Trip Detail</h3>
          <button onClick={onClose} className="rounded p-1 text-foam/60 hover:bg-foam/10">
            ✕
          </button>
        </div>
        <div className="space-y-3 text-sm">
          <Row label="Status" value={TRIP_STATUS_LABEL[trip.status]} />
          <Row label="Destination" value={trip.destination ?? "—"} />
          <Row label="Fishing area" value={trip.fishing_area ?? "—"} />
          <Row
            label="Planned departure"
            value={trip.planned_departure ? new Date(trip.planned_departure).toLocaleString() : "—"}
          />
          <Row
            label="Actual departure"
            value={trip.actual_departure ? new Date(trip.actual_departure).toLocaleString() : "—"}
          />
          <Row
            label="Expected return"
            value={trip.expected_return ? new Date(trip.expected_return).toLocaleString() : "—"}
          />
          <Row
            label="Actual return"
            value={trip.actual_return ? new Date(trip.actual_return).toLocaleString() : "—"}
          />
          {trip.notes && <Row label="Notes" value={trip.notes} />}
          {trip.crew && trip.crew.length > 0 && (
            <div>
              <div className="text-[11px] uppercase tracking-wider text-foam/50 mb-1">Crew</div>
              <ul className="space-y-1">
                {trip.crew.map((c) => (
                  <li key={c.id} className="flex items-center gap-2 text-foam/70">
                    <Users className="h-3 w-3 text-foam/40" />
                    {c.fisherman?.full_name ?? c.fisherman_id}
                    {c.role && <span className="text-foam/40">· {c.role}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-[11px] uppercase tracking-wider text-foam/40 shrink-0">{label}</span>
      <span className="text-foam/80 text-right">{value}</span>
    </div>
  );
}

function Panel({
  label,
  icon,
  children,
}: {
  label: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-foam/10 bg-foam/[0.03] p-5">
      <div className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-foam/50">
        {icon}
        {label}
      </div>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="text-[11px] uppercase tracking-wider text-foam/50">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg border border-foam/10 bg-ocean/40 px-3 py-2 text-sm text-foam outline-none focus:border-tide/60"
      />
    </label>
  );
}
