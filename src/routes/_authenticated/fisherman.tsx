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
import { getTripRequestBlockedReason } from "@/lib/trip-request";
import { cancelSos, cancelTripRequest, checkInTrip, createTripRequest, triggerSos } from "@/lib/server-ops";
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
  active: boolean;
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
  captain_id: string | null;
  status: TripStatus;
  created_at?: string | null;
  planned_departure: string | null;
  actual_departure: string | null;
  expected_return: string | null;
  actual_return: string | null;
  fishing_area: string | null;
  destination: string | null;
  notes: string | null;
  boat?: BoatRow | null;
  captain?: { full_name: string | null; phone: string | null } | null;
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
      { data: captainTrips },
      { data: crewRows },
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
          "*, captain:captain_id(full_name,phone), boat:boat_id(id,name,registration_number,boat_type), crew:trip_crew(id,fisherman_id,role,fisherman:fisherman_id(full_name))",
        )
        .eq("captain_id", prof.fisherman_id)
        .order("created_at", { ascending: false })
        .limit(30),
      supabase.from("trip_crew").select("trip_id").eq("fisherman_id", prof.fisherman_id),
      supabase
        .from("sos_alerts")
        .select("*")
        .eq("fisherman_id", prof.fisherman_id)
        .in("status", ["new", "acknowledged", "assigned", "in_progress"])
        .order("started_at", { ascending: false })
        .limit(1),
      supabase
        .from("fishermen")
        .select("id, full_name, phone, bmu_id")
        .eq("active", true)
        .neq("id", prof.fisherman_id)
        .eq("bmu_id", prof.bmu_id)
        .order("full_name"),
    ]);
    const crewTripIds = Array.from(
      new Set(((crewRows ?? []) as Array<{ trip_id: string }>).map((row) => row.trip_id).filter(Boolean)),
    );
    const { data: crewTrips } =
      crewTripIds.length > 0
        ? await supabase
            .from("sea_trips")
            .select(
              "*, captain:captain_id(full_name,phone), boat:boat_id(id,name,registration_number,boat_type), crew:trip_crew(id,fisherman_id,role,fisherman:fisherman_id(full_name))",
            )
            .in("id", crewTripIds)
            .order("created_at", { ascending: false })
            .limit(30)
        : { data: [] };
    const tripMap = new Map<string, Trip>();
    for (const trip of ([...(captainTrips ?? []), ...(crewTrips ?? [])] as unknown as Trip[])) {
      tripMap.set(trip.id, trip);
    }
    const mergedTrips = Array.from(tripMap.values()).sort((a, b) => {
      const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;
      const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;
      return bTime - aTime;
    });
    setFisherman(fm as FishermanFull);
    setBoat((bts?.[0] as BoatRow) ?? null);
    setDevice((dvs?.[0] as DeviceRow) ?? null);
    setTrips(mergedTrips);
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

  const ACTIVE_TRIP_STATUSES: TripStatus[] = [
    "pending_approval",
    "checked_out",
    "at_sea",
    "sos",
    "rescue_in_progress",
    "overdue",
  ];
  const CAN_CHECKIN_STATUSES: TripStatus[] = ["at_sea", "overdue", "rescued"];

  const activeTrip = trips.find((t) => ACTIVE_TRIP_STATUSES.includes(t.status));
  const activeTripIsCaptain = !!activeTrip && activeTrip.captain_id === profile?.fisherman_id;
  const activeTripIsCrew = !!activeTrip && !activeTripIsCaptain;

  const tripRequestBlockedReason = getTripRequestBlockedReason({
    activeTripExists: !!activeTrip,
    fishermanActive: fisherman?.active,
    hasBoat: !!boat,
    hasDevice: !!device,
    deviceActive: device?.active,
    expectedReturn: form.expected_return,
    destination: form.destination,
    fishingArea: form.fishing_area,
  });

  const canCheckIn = activeTrip ? CAN_CHECKIN_STATUSES.includes(activeTrip.status) : false;

  async function triggerSoftwareSos() {
    if (!profile?.fisherman_id || !device) return;
    if (!device.active) {
      alert("Your assigned SOS device is disabled. Contact your BMU officer.");
      return;
    }
    setBusy(true);
    try {
      navigator.geolocation.getCurrentPosition(
        async (position) => {
          const lat = position.coords.latitude;
          const lng = position.coords.longitude;
          const accuracy = position.coords.accuracy;

          const { data: alertId, error: alertErr } = await triggerSos({
            deviceId: device.id,
            lat,
            lng,
            accuracy,
            notes: "Triggered via software client on mobile/web portal",
          });

          if (alertErr) {
            alert(alertErr.message);
          } else if (alertId) {
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
    const falseAlarmReason = window.prompt(
      "Please provide a brief reason for cancelling the SOS (false alarm):",
      "",
    );
    if (!falseAlarmReason || falseAlarmReason.trim().length === 0) {
      alert("SOS cancelation requires a reason. If this was not a false alarm, do not cancel.");
      return;
    }
    setBusy(true);
    try {
      const { error } = await cancelSos(activeAlert.id, falseAlarmReason);
      if (error) {
        throw error;
      }
      setActiveAlert(null);
      await load();
    } catch (e) {
      alert(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function cancelPendingTrip(tripId: string) {
    if (!window.confirm("Cancel this pending trip request?")) return;
    setBusy(true);
    try {
      const { error } = await cancelTripRequest(tripId);
      if (error) {
        alert(error.message);
      }
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function checkOut() {
    if (!profile?.fisherman_id) return;
    const blockedReason = getTripRequestBlockedReason({
      activeTripExists: !!activeTrip,
      fishermanActive: fisherman?.active,
      hasBoat: !!boat,
      hasDevice: !!device,
      deviceActive: device?.active,
      expectedReturn: form.expected_return,
      destination: form.destination,
      fishingArea: form.fishing_area,
    });
    if (blockedReason) {
      alert(blockedReason);
      return;
    }
    if (form.expected_return) {
      const returnDate = new Date(form.expected_return);
      if (returnDate < new Date()) {
        alert("Expected return date cannot be in the past!");
        return;
      }
    }
    setBusy(true);
    try {
      const { data: tripId, error: tripErr } = await createTripRequest({
        boatId: boat?.id ?? null,
        deviceId: device?.id ?? null,
        destination: form.destination || null,
        fishingArea: form.fishing_area || null,
        expectedReturn: form.expected_return || null,
        notes: form.notes || null,
        crewIds: selectedCrew,
      });

      if (tripErr) {
        alert(tripErr.message);
      } else if (tripId) {
        // no-op; the RPC already created the trip and crew links
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
      const { error } = await checkInTrip(tripId);
      if (error) {
        alert(error.message);
      }
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
                  {activeTrip && activeTripIsCaptain && activeTrip.status === "at_sea" && (
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
                  {activeTripIsCaptain ? "Captain trip" : "Crew trip"} ·{" "}
                  {TRIP_STATUS_LABEL[activeTrip.status]}
                </div>
                <div className="mt-2 text-lg font-semibold">
                  {activeTrip.destination ?? "At sea"}
                </div>
                {activeTripIsCrew && (
                  <div className="mt-1 text-sm text-foam/70">
                    Captain: {activeTrip.captain?.full_name ?? "Unknown"}
                    {activeTrip.captain?.phone ? ` · ${activeTrip.captain.phone}` : ""}
                  </div>
                )}
                {activeTrip.boat && (
                  <div className="mt-1 text-sm text-foam/70">
                    Boat: {activeTrip.boat.name}
                    {activeTrip.boat.registration_number ? ` · ${activeTrip.boat.registration_number}` : ""}
                  </div>
                )}
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

                {activeTripIsCrew ? (
                  <div className="mt-4 rounded-xl border border-foam/10 bg-ocean/30 p-3 text-xs text-foam/70">
                    You are listed as crew on this trip. The captain manages trip cancellation,
                    SOS, and check-in for the vessel.
                  </div>
                ) : activeTrip.status === "pending_approval" ? (
                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    <div className="text-xs text-yellow-300/80">
                      Waiting for BMU officer approval before departure.
                    </div>
                    <button
                      onClick={() => cancelPendingTrip(activeTrip.id)}
                      disabled={busy}
                      className="rounded-lg border border-yellow-500/30 px-3 py-1.5 text-xs font-semibold text-yellow-200 hover:bg-yellow-500/10 disabled:opacity-60"
                    >
                      Cancel request
                    </button>
                  </div>
                ) : canCheckIn ? (
                  <button
                    onClick={() => checkIn(activeTrip.id)}
                    disabled={busy}
                    className="mt-4 inline-flex items-center gap-2 rounded-lg bg-tide px-4 py-2 text-sm font-semibold text-ocean hover:bg-tide/90 disabled:opacity-60"
                  >
                    <LogIn className="h-4 w-4" /> Check in — I'm back
                  </button>
                ) : (
                  <div className="mt-4 text-xs text-foam/70">
                    This trip cannot be checked in while it is in{" "}
                    {TRIP_STATUS_LABEL[activeTrip.status].toLowerCase()} status. The SOS or rescue
                    incident must be resolved first.
                  </div>
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
                  disabled={busy || !!tripRequestBlockedReason}
                  className="mt-4 rounded-lg bg-distress px-4 py-2 text-sm font-semibold text-foam hover:bg-distress/90 disabled:opacity-60"
                >
                  Submit trip request
                </button>
                {tripRequestBlockedReason ? (
                  <div className="mt-3 rounded-xl border border-yellow-500/20 bg-yellow-500/5 p-3 text-xs text-yellow-200">
                    {tripRequestBlockedReason}
                  </div>
                ) : null}
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
