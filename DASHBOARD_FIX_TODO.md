# Dashboard Integration, Security, and Reliability TODO

## Priority 0: Database Access Control

- [ ] Replace broad `USING (true)` / `WITH CHECK (true)` RLS policies on operational tables.
- [x] Add role-aware RLS for `sos_alerts`, `rescue_operations`, `sea_trips`, `trip_crew`, `devices`, `fishermen`, `boats`, `profiles`, `gps_logs`, `notifications`, and related operational tables.
- [ ] Ensure fishermen can only read/write their own linked records and trips.
- [ ] Ensure BMU officers can only manage records for their assigned BMU.
- [ ] Ensure rescue officers can read active rescue/SOS data but cannot manage unrelated admin data.
- [ ] Ensure admins can manage users/roles through controlled functions only.
- [ ] Prevent browser clients from reading `devices.device_secret`.
- [ ] Replace broad profile update policy with scoped profile update rules.
- [ ] Add a BMU officer assignment model so each BMU officer is explicitly scoped to one or more BMUs.
- [ ] Prevent staff accounts from being linked to fisherman records.
- [ ] Prevent one fisherman record from being linked to multiple user profiles.

## Priority 1: Secure Server-Side Operations

- [x] Move role changes from direct browser writes to admin-only RPC/server actions.
- [x] Move fisherman trip creation/check-in to RPC/server actions with ownership checks.
- [x] Move software SOS trigger/cancel to RPC/server actions with fisherman/device ownership checks.
- [x] Move rescue alert status changes to rescue-officer-only RPC/server actions.
- [x] Move BMU registration actions for fishermen, boats, devices, crew, and trip approval to BMU-scoped RPC/server actions.
- [x] Enforce valid alert and trip status transitions in the database.
- [x] Add audit logging for role changes, trip status changes, SOS cancellation, rescue assignment, and alert closure.
- [x] Prevent an admin from removing the last admin role or accidentally locking themselves out.
- [x] Require reason/notes for rejecting trips, cancelling SOS, closing rescue operations, and disabling devices.

## Priority 2: Hardware Ingest Hardening

- [ ] Store hashed device secrets instead of plaintext secrets.
- [ ] Add device secret rotation support.
- [ ] Add request timestamp and nonce/replay protection to hardware ingest endpoints.
- [ ] Add rate limiting per device ID and source IP.
- [ ] Add structured ingest logs for accepted and rejected device requests.
- [ ] Return generic auth errors so attackers cannot distinguish unknown device IDs from bad secrets.
- [ ] Confirm inactive devices cannot trigger SOS, location, or cancel operations.

## Priority 3: Dashboard Completeness

- [ ] Fix Fisherman active-trip logic to include `sos`, `rescue_in_progress`, and `overdue` (also required for SOS cancel to restore trip — see **Fisherman Cancel & State Restoration** below).
- [ ] Prevent trip check-in while a trip is in SOS/rescue state unless explicitly resolved.
- [ ] Filter crew selection by BMU and active/eligible fisherman records.
- [ ] Treat `captain` as a trip context, not a separate system role.
- [ ] Update the Fisherman dashboard to branch between no-trip, captain-pending, captain-at-sea, and crew-view states.
- [ ] Show "Request Trip as Captain" only when the fisherman is active, has an assigned active device, and is not already on an active trip.
- [ ] Show "Captain Controls" only when the current fisherman is `sea_trips.captain_id`.
- [ ] Show "Crew View" when the current fisherman appears in `trip_crew` for an active or pending trip.
- [ ] Hide captain-only controls from crew members, including edit trip, add/remove crew, cancel trip, and whole-trip check-in.
- [ ] Show crew members captain name, captain phone, boat, destination/fishing area, expected return, and trip status.
- [ ] Prevent the captain from adding themselves as a crew member.
- [ ] Add clear error/success messages instead of browser `alert()`.
- [ ] Add loading, empty, and failed states for all dashboard data panels.
- [ ] Fix broken/mojibake UI text such as `â€”`, `Â·`, and corrupted icons.
- [ ] Add confirmation flows for destructive/high-risk actions such as cancel SOS, cancel trip request, and role removal.

## Fisherman Cancel & State Restoration

When a fisherman cancels, operational state must return to what it was before the cancelled action. Historical records (GPS logs, trip history, closed alerts) stay for audit.

### Cancel trip request (`pending_approval`)

- [ ] Add captain-only "Cancel request" action on `pending_approval` trips in the Fisherman dashboard (currently only BMU reject exists in `bmu.tsx`).
- [ ] Set trip status to `cancelled`; do not touch alerts, devices, or crew history.
- [ ] Return UI to no-active-trip state so the fisherman can submit a new request.
- [ ] Add confirmation dialog before cancelling a pending request.

### Cancel SOS (false alarm while at sea)

- [ ] On SOS cancel, close the open `sos_alerts` row (`status = closed`, `resolved_at` set).
- [ ] Restore trip from `sos` or `rescue_in_progress` back to `at_sea` (not `returned` or `cancelled`).
- [ ] Close or resolve any open `rescue_operations` linked to the alert.
- [ ] Stop rescue dashboard alarm/realtime distress state for that incident.
- [x] **Fix software cancel bug:** `cancelSoftwareSos()` now restores the trip when the active trip is in `sos` or `rescue_in_progress`, and the cancel path uses the shared helper for state restoration.
- [x] Unify software cancel (`cancelSoftwareSos`) and hardware cancel (`/api/public/ingest/cancel`) so both update alert, trip, and rescue_operations in the same way.
- [x] Require a false-alarm reason/note on every fisherman SOS cancel; the software path prompts for a reason and the hardware path records a cancel note while closing the alert.
- [ ] If rescue has already acknowledged or assigned the alert, still allow cancel only through the controlled flow above and notify rescue officers (do not silently undo an in-progress response).
- [ ] Keep GPS logs and prior alert rows immutable; only operational status fields reset.

### What must NOT change on cancel

- [ ] Device assignment, boat ownership, and fisherman profile links stay unchanged.
- [ ] Crew membership on the trip stays unchanged (trip remains `at_sea` after SOS cancel, or `cancelled` after request cancel).
- [ ] Do not delete `gps_logs`, `trip_status_history`, or closed alert records.

## Priority 4: Onboarding and Rescue Workflow Rules

- [ ] Define the official onboarding flow: admin creates/promotes BMU officer, BMU registers fisherman, BMU registers boat, BMU registers device, device is provisioned, fisherman requests trip, BMU approves trip.
- [ ] Keep system roles limited to `admin`, `bmu_officer`, `fisherman`, and `rescue_officer`.
- [ ] Store captain/crew responsibility at the trip level: captain in `sea_trips.captain_id`, crew in `trip_crew`.
- [ ] Allow only the trip captain to create the trip request and propose crew members.
- [ ] Allow BMU officers to review, approve, reject, or request changes to captain-proposed crew before departure.
- [ ] Lock crew changes after approval unless a BMU officer performs or approves the change.
- [ ] Require unique fisherman identity fields where practical, such as national ID and phone number.
- [ ] Ensure fisherman BMU, boat BMU, and device boat assignment are consistent before a trip can be approved.
- [ ] Add BMU dashboard validation that a fisherman, boat, and device are ready before trip approval.
- [ ] Show BMU officers device freshness before approving departure.
- [ ] Show fishermen why trip request submission is blocked when profile, boat, or device setup is incomplete.
- [ ] Prevent inactive fishermen from requesting or joining trips.
- [ ] Prevent inactive/unverified boats from being used on trips.
- [ ] Prevent disabled or stale devices from being used for new trip approvals.
- [ ] Prevent overlapping active trips for the same fisherman, boat, or device.
- [ ] Require `expected_return` and destination/fishing area before BMU approval.
- [ ] Define allowed trip transitions, for example `pending_approval -> at_sea -> returned`, `pending_approval -> cancelled` (captain withdraws request), `at_sea -> sos -> rescue_in_progress -> rescued/returned`, `sos -> at_sea` (false-alarm cancel), and `at_sea -> overdue`.
- [ ] Define allowed SOS transitions, for example `new -> acknowledged -> assigned -> in_progress -> resolved -> closed`, and `new/acknowledged/assigned/in_progress -> closed` (false-alarm cancel with reason).
- [ ] Enforce fisherman-driven SOS cancellation rules in DB/RPC (see **Fisherman Cancel & State Restoration**): auto-mark fisherman-initiated cancels as false alarms; notify rescue if already acknowledged/assigned.
- [ ] Require rescue closure notes, outcome, assigned team, and timestamps before an incident can be fully closed.
- [ ] Keep historical trips, alerts, GPS logs, and rescue operations immutable or soft-deleted only.
- [ ] Add post-incident review visibility for BMU officers and admins.

## Priority 5: Rescue Dashboard Performance

- [ ] Replace full SOS list reloads on every realtime event with targeted payload patching.
- [ ] Paginate or virtualize historical SOS/incidents.
- [ ] Move dashboard statistics into a single summary RPC or database view.
- [ ] Reduce polling frequency where realtime already covers updates.
- [ ] Ensure realtime subscriptions are cleaned up correctly.
- [ ] Compress  the 4.5 MB alarm audio asset.
- [ ] Code-split Leaflet and rescue-heavy modules more aggressively.

## Priority 6: Admin Dashboard Reliability

- [ ] Confirm admins can read all required profiles and roles under final RLS.
- [ ] Add server-side role assignment validation.
- [ ] Add search/filtering for large user lists.
- [ ] Show linked fisherman details and BMU context.
- [ ] Prevent linking one fisherman record to multiple user profiles except through an intentional reassignment flow.
- [ ] Add BMU officer to BMU assignment management.
- [ ] Prevent role changes that violate existing fisherman/profile/BMU assignment constraints.

## Priority 7: Verification

- [ ] Normalize line endings so `npm.cmd run lint` passes.
- [ ] Run `npm.cmd run build` after each major change.
- [ ] Add RLS/RPC permission tests for fisherman, BMU officer, rescue officer, and admin users.
- [ ] Add workflow tests for trip request, BMU approval, captain cancel trip request, SOS trigger, rescue assignment, fisherman SOS cancel (restores trip to `at_sea`), hardware SOS cancel, and rescue resolution.
- [ ] Update `README.md` and `HARDWARE_INTEGRATION.md` with the final provisioning and security model.
