# Dashboard Integration, Security, and Reliability TODO

## Priority 0: Database Access Control

Status: mostly implemented. Role-aware RLS is in place for every operational table, and
fishermen/staff are correctly scoped to their own rows. The remaining gaps are BMU-level
scoping (no assignment model yet) and `device_secret` exposure over the browser channel.

- [x] Replace broad `USING (true)` / `WITH CHECK (true)` RLS policies on operational tables. (All `… all auth` / `… auth` policies dropped & replaced in `20260714000001`, `20260714000002`, `20260714000009`.)
- [x] Add role-aware RLS for `sos_alerts`, `rescue_operations`, `sea_trips`, `trip_crew`, `devices`, `fishermen`, `boats`, `profiles`, `gps_logs`, `notifications`, and related operational tables.
- [x] Ensure fishermen can only read/write their own linked records and trips. (Enforced via `current_fisherman_id()` + `trip_has_current_fisherman()` in `20260714000009`; crew can read their trips. Note: fisherman self-write to `fishermen`/`boats` is intentionally delegated to BMU officers.)
- [ ] Ensure BMU officers can only manage records for their assigned BMU. (Blocked by missing assignment model below — currently all BMU officers see/write every BMU's data.)
- [x] Ensure rescue officers can read active rescue/SOS data but cannot manage unrelated admin data. (Rescue officers cannot write `bmus`/`fishermen`/`boats`/`devices`/`profiles`/`user_roles`. Gap: RLS still permits direct write to `sea_trips`/`sos_alerts`, and reads ALL alerts not just active ones — tighten in Priority 1.)
- [x] Ensure admins can manage users/roles through controlled functions only. (`set_user_role()` RPC with last-admin guard exists; RLS still permits direct admin table writes — fully RPC-only enforcement is Priority 1.)
- [x] Prevent browser clients from reading `devices.device_secret`. (Column-level `REVOKE SELECT (device_secret, device_secret_hash) ... FROM authenticated` in `20260812000000`, which applies underneath RLS. The `devices read scoped` policy had been handing every device secret to admin, BMU officer **and rescue officer** sessions — a rescue officer could have forged an SOS or cancelled a real one. `bmu.tsx` now selects explicit columns, since `select("*")` would fail on the revoked column.)
- [x] Replace broad profile update policy with scoped profile update rules. (`profiles update scoped` = own row or admin, in `20260714000002`.)
- [ ] Add a BMU officer assignment model so each BMU officer is explicitly scoped to one or more BMUs. (No assignment table/function exists yet; required before BMU scoping works.)
- [ ] Reconcile multi-role resolution between the database and the UI. (`current_user_role()` collapses a user's roles with `ORDER BY role LIMIT 1`, which on the `app_role` enum means admin > bmu_officer > rescue_officer > fisherman; `pickPrimary()` in `use-role.ts` uses admin > rescue_officer > bmu_officer > fisherman. A user holding both `bmu_officer` and `rescue_officer` is therefore routed to `/rescue` by the UI while RLS evaluates them as a BMU officer. Not a privilege escalation — every right they get is one they were actually granted — but the effective permissions do not match the dashboard they land on. The durable fix is to make the RLS helpers role-set-aware (`has_role(...)` per policy) rather than picking a single winner; simply reordering `current_user_role()` would silently remove access from existing multi-role accounts.)
- [x] Prevent staff accounts from being linked to fisherman records. (`chk_fisherman_link_staff` CHECK + `link_profile_to_fisherman` / `admin_link_profile_to_fisherman` RPC guards.)
- [x] Prevent one fisherman record from being linked to multiple user profiles. (`profiles_one_user_per_fisherman` unique partial index + dedup in `20260714000009`.)

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

Status: implemented in `20260812000000_hardware_ingest_security.sql` and
`src/lib/ingest-core.ts`. The three endpoints now share one code path
(`handleSos`/`handleLocation`/`handleCancel`), so auth, status codes and logging
cannot drift between them. Remaining gap is durable rate limiting.

- [x] Store hashed device secrets instead of plaintext secrets. (`devices.device_secret_hash`, SHA-256, backfilled from the existing plaintext so deployed devices did not need re-flashing. The plaintext column is retained but revoked for one release to keep the change reversible — drop it once the fleet is verified.)
- [x] Add device secret rotation support. (`rotate_bmu_device_secret()` RPC + "Rotate device secret" in the BMU console; returns the plaintext once and writes an audit event.)
- [x] Generate secrets with a CSPRNG. (`generate_device_secret()` uses `gen_random_bytes(32)`. The previous `md5(random())` was predictable — Postgres `random()` is a seeded PRNG, so a guessed secret could forge an SOS or, worse, forge a `/cancel` that closes a real distress alert.)
- [x] Add request timestamp and nonce/replay protection to hardware ingest endpoints. (Timestamp freshness is enforced when the device supplies one — ±10 min. `event_id` gives per-event idempotency via a unique index on `sos_alerts(device_id, ingest_event_id)`. The previous `isReplayAttempt()` helper was never called by anything and has been removed rather than left as decorative security.)
- [x] Add rate limiting per device ID and source IP. (Unauthenticated traffic is throttled per source IP; authenticated traffic per device UUID *after* the secret is verified — throttling on an unauthenticated `device_id` let anyone who learned a device label suppress that device's next SOS.)
- [ ] Make rate limiting durable across serverless instances. (`checkRateLimit` is an in-process `Map`: each cold instance starts empty and concurrent instances do not share counters, so it bounds one misbehaving connection but is not a defence against a distributed flood. Needs a shared store.)
- [x] Add structured ingest logs for accepted and rejected device requests. (Every request gets a trace id, returned in `x-seaguard-trace`, logged as one JSON line server-side and stored in `ingest_request_logs.trace_id`.)
- [x] Return generic auth errors so attackers cannot distinguish unknown device IDs from bad secrets. (Both produce a byte-identical 401. Internal detail goes to the audit log only — the endpoint previously returned raw exception messages to unauthenticated callers.)
- [x] Confirm inactive devices cannot trigger SOS, location, or cancel operations. (403 on all three, covered by tests in `src/lib/ingest-core.test.ts`.)
- [x] Never answer a server-side fault with a permanent 4xx. (Storage failures now return 503. Returning 400 for a database outage told the firmware an emergency was permanently invalid and it discarded the SOS.)
- [ ] Drop `devices.device_secret` once the hashed column is confirmed across the fleet.

## Priority 2b: Firmware Reliability

Status: implemented in `firmware/rescue_watch/`. See HARDWARE_INTEGRATION.md for
the reconciled behaviour and the list of what still needs a physical device.

- [x] **Root cause of "SOS does not reach the dashboard":** `postJson()` never issued `AT+HTTPTERM`. The SIM800L permits one HTTP session, so the second `AT+HTTPINIT` returns `ERROR`. The 15-second location ping consumed the only session at boot, and every request afterwards — including the SOS — aborted before a byte went out.
- [x] Parse `+HTTPACTION` tolerantly. (The modem emits `+HTTPACTION: 1,200,52` with a space; the code matched `+HTTPACTION:1,200` exactly, so even the one request that did go out was reported as a failure. Now covered by `firmware/test/test_at_parse.cpp`.)
- [x] Stop long-press cancelling when there is no SOS to cancel. (Holding the button — the natural panic reaction — used to send `/cancel` after 1.5 s instead of raising an SOS. Now 3 s, and only when an SOS is open.)
- [x] Accept roaming registration. (`AT+CREG?` matched only `0,1`; a device attached to a partner network as `0,5` was treated as unregistered.)
- [x] Retry a failed SOS. (Capped exponential backoff, indefinitely, until the server confirms. Previously `STATE_FAIL` returned to idle and the SOS was gone.)
- [x] Never transmit a fabricated position. (No fix sent `0,0`, which the API accepted, dropping the rescue marker in the Gulf of Guinea. The API now rejects `0,0` as "no fix" and accepts an SOS without coordinates.)
- [x] Stop reporting a fabricated battery level. (Was hardcoded `80`. Now behind `BATTERY_SENSE_ENABLED`, off by default, and the field is omitted rather than invented.)
- [x] Remove the hardcoded device credential from the sketch. (Moved to a git-ignored `secrets.h`. The committed secret must be treated as compromised — see below.)
- [ ] **Rotate the device secret for `DEV-9WK7LO`.** It was committed in the firmware source and is in the git history, which cannot be rewritten (the Lovable sync in AGENTS.md forbids it). Rotate from the BMU console and re-flash. Until then, anyone with repository access can forge that device's SOS and cancel its real ones.
- [ ] Verify SIM800L TLS against the deployment host. (Older modem firmware negotiates only TLS 1.0. Requires physical hardware.)

## Priority 3: Dashboard Completeness

Status: largely implemented in `src/routes/_authenticated/fisherman.tsx`. The branching,
scoping, and crew-filtering logic is in place. Remaining gaps are UX polish: replace
`alert()`/`prompt()`/`confirm()` with in-app UI, add loading/failed states, surface
`fishing_area` in the crew active-trip card, and formalize destructive-action confirmations.

- [x] Fix Fisherman active-trip logic to include `sos`, `rescue_in_progress`, and `overdue`. (`ACTIVE_TRIP_STATUSES` at fisherman.tsx:209.)
- [x] Prevent trip check-in while a trip is in SOS/rescue state unless explicitly resolved. (`CAN_CHECKIN_STATUSES` = `at_sea`/`overdue`/`rescued`; blocked message at fisherman.tsx:593.)
- [x] Filter crew selection by BMU and active/eligible fisherman records. (Query filters `active=true`, `bmu_id` match, excludes self — fisherman.tsx:144.)
- [x] Treat `captain` as a trip context, not a separate system role. (`sea_trips.captain_id`; no captain system role.)
- [x] Update the Fisherman dashboard to branch between no-trip, captain-pending, captain-at-sea, and crew-view states. (Branches at fisherman.tsx:508–677.)
- [x] Show "Request Trip as Captain" only when the fisherman is active, has an assigned active device, and is not already on an active trip. (`getTripRequestBlockedReason` + disabled submit at fisherman.tsx:665.)
- [x] Show "Captain Controls" only when the current fisherman is `sea_trips.captain_id`. (`activeTripIsCaptain` gates controls at fisherman.tsx:220.)
- [x] Show "Crew View" when the current fisherman appears in `trip_crew` for an active or pending trip. (`activeTripIsCrew` at fisherman.tsx:221.)
- [x] Hide captain-only controls from crew members, including edit trip, add/remove crew, cancel trip, and whole-trip check-in. (Crew sees only an info notice at fisherman.tsx:567.)
- [ ] Show crew members captain name, captain phone, boat, destination/fishing area, expected return, and trip status. (Name/phone/boat/destination/expected return/status shown, but `fishing_area` is missing from the active-trip card — only in the detail modal at fisherman.tsx:759.)
- [x] Prevent the captain from adding themselves as a crew member. (Self excluded from crew picker at fisherman.tsx:148.)
- [ ] Add clear error/success messages instead of browser `alert()`. (Still uses `alert()`/`prompt()`/`confirm()` throughout fisherman.tsx:239, 259, 266, 279, 284, 296, 303, 308, 329, 335, 352, 369.)
- [ ] Add loading, empty, and failed states for all dashboard data panels. (Empty state only for trip history; no loading spinner and no failed/error panel for `load()`.)
- [x] Fix broken/mojibake UI text such as `â€”`, `Â·`, and corrupted icons. (No mojibake found in any `.tsx`; proper `—`/`·` used.)
- [ ] Add confirmation flows for destructive/high-risk actions such as cancel SOS, cancel trip request, and role removal. (Cancel trip request uses `window.confirm` at fisherman.tsx:303; cancel SOS only uses a `window.prompt` for the reason at fisherman.tsx:279, no explicit confirm dialog; role removal lives in the admin dashboard — Priority 6.)

## Fisherman Cancel & State Restoration

When a fisherman cancels, operational state must return to what it was before the cancelled action. Historical records (GPS logs, trip history, closed alerts) stay for audit.

### Cancel trip request (`pending_approval`)

- [x] Add captain-only "Cancel request" action on `pending_approval` trips in the Fisherman dashboard (currently only BMU reject exists in `bmu.tsx`). (Renders for captain branch at fisherman.tsx:577; crew sees the info notice instead.)
- [x] Set trip status to `cancelled`; do not touch alerts, devices, or crew history. (`cancel_fisherman_trip_request` RPC at `20260714000008` only updates `sea_trips`.)
- [x] Return UI to no-active-trip state so the fisherman can submit a new request. (`cancelPendingTrip` calls `load()`; `cancelled` is excluded from `ACTIVE_TRIP_STATUSES`.)
- [x] Add confirmation dialog before cancelling a pending request. (`window.confirm` at fisherman.tsx:303 — flagged for in-app replacement under Priority 3 #12/#15.)

### Cancel SOS (false alarm while at sea)

- [x] On SOS cancel, close the open `sos_alerts` row (`status = closed`, `resolved_at` set). (`cancel_fisherman_sos` RPC.)
- [x] Restore trip from `sos` or `rescue_in_progress` back to `at_sea` (not `returned` or `cancelled`). (`cancel_fisherman_sos`: `update sea_trips set status='at_sea' where captain_id=... and status in ('sos','rescue_in_progress')`.)
- [x] Close or resolve any open `rescue_operations` linked to the alert. (`cancel_fisherman_sos` sets `rescue_operations.status='closed'`.)
- [x] Stop rescue dashboard alarm/realtime distress state for that incident. (Closed alert leaves the active incident set; realtime still pushes the status change.)
- [x] **Fix software cancel bug:** `cancelSoftwareSos()` now restores the trip when the active trip is in `sos` or `rescue_in_progress`, and the cancel path uses the shared helper for state restoration.
- [x] Unify software cancel (`cancelSoftwareSos`) and hardware cancel (`/api/public/ingest/cancel`) so both update alert, trip, and rescue_operations in the same way. (Both use `src/lib/sos-cancel.ts` `buildSosCancelPatch`/`buildRescueOperationPatch`/`shouldRestoreTripStatus`. Divergence: software sets `rescue_operations.status='closed'`, hardware sets `'resolved'`; hardware restores the trip by `boat_id`, software by `captain_id`.)
- [x] Require a false-alarm reason/note on every fisherman SOS cancel; the software path prompts for a reason and the hardware path records a cancel note while closing the alert. (`cancel_fisherman_sos` raises if reason is empty; hardware uses `"Hardware cancel"`.)
- [x] If rescue has already acknowledged or assigned the alert, still allow cancel only through the controlled flow above and notify rescue officers (do not silently undo an in-progress response). (Hardware path: `handleCancel` raises a `dashboard` notification for every alert cancelled out of `acknowledged`/`assigned`/`in_progress`, using the existing `notifications` table and realtime channel — no external provider was invented. Software path via `cancel_fisherman_sos` still cancels silently; unifying it is the remaining half of this item.)
- [ ] Raise the same rescue notification from the software cancel path (`cancel_fisherman_sos`).
- [x] Keep GPS logs and prior alert rows immutable; only operational status fields reset. (RPCs only update `status`/`resolved_at`/`ended_at`/`notes`; rows are never deleted.)

### What must NOT change on cancel

- [x] Device assignment, boat ownership, and fisherman profile links stay unchanged. (No RPC touches these tables on cancel.)
- [x] Crew membership on the trip stays unchanged (trip remains `at_sea` after SOS cancel, or `cancelled` after request cancel). (`trip_crew` is never modified by the cancel flows.)
- [x] Do not delete `gps_logs`, `trip_status_history`, or closed alert records. (Cancel flows only `update`, never `delete`.)

## Priority 4: Onboarding and Rescue Workflow Rules

Status: the core onboarding path and all status-transition definitions are implemented.
Gaps cluster in two areas: (a) readiness/consistency validation at trip approval, and
(b) "immutability" — BMU officers can still hard-delete fishermen/boats/devices.

- [x] Define the official onboarding flow: admin creates/promotes BMU officer, BMU registers fisherman, BMU registers boat, BMU registers device, device is provisioned, fisherman requests trip, BMU approves trip. (admin.tsx `set_user_role`; bmu.tsx `manage_bmu_*`; fisherman.tsx `createTripRequest`; `bmu_transition_trip` for approval.)
- [x] Keep system roles limited to `admin`, `bmu_officer`, `fisherman`, and `rescue_officer`. (`app_role` enum + `ROLES` const in admin.tsx:22.)
- [x] Store captain/crew responsibility at the trip level: captain in `sea_trips.captain_id`, crew in `trip_crew`.
- [x] Allow only the trip captain to create the trip request and propose crew members. (`create_fisherman_trip_request` sets `captain_id` = caller's fisherman, accepts `p_crew_ids`; role-checked to `fisherman`.)
- [x] Allow BMU officers to review, approve, reject, or request changes to captain-proposed crew before departure. (bmu.tsx `TripsSection` approve/reject + `CrewModal` add/remove crew.)
- [ ] Lock crew changes after approval unless a BMU officer performs or approves the change. (`manage_trip_crew_member` only checks `bmu_officer` role — no trip-status guard; crew can be edited on `at_sea` trips too.)
- [ ] Require unique fisherman identity fields where practical, such as national ID and phone number. (`fishermen.national_id`/`phone` have no UNIQUE constraint; only `registration_number`, `device_id`, `(trip_id,fisherman_id)`, and `profiles`→`fisherman` are unique.)
- [ ] Ensure fisherman BMU, boat BMU, and device boat assignment are consistent before a trip can be approved. (`create_fisherman_trip_request` checks boat/device ownership by fisherman but not BMU alignment; `bmu_transition_trip` checks nothing.)
- [ ] Add BMU dashboard validation that a fisherman, boat, and device are ready before trip approval. (Approve button calls `transitionTrip` with no readiness gate; readiness is only enforced client-side at request time.)
- [ ] Show BMU officers device freshness before approving departure. (Freshness shown in `DevicesSection` (`isStale` > 15 min) but NOT on the trip approval card.)
- [x] Show fishermen why trip request submission is blocked when profile, boat, or device setup is incomplete. (`getTripRequestBlockedReason` in lib/trip-request.ts + inline reason in fisherman.tsx.)
- [ ] Prevent inactive fishermen from requesting or joining trips. (`create_fisherman_trip_request` does not check `fisherman.active`; `manage_trip_crew_member` does not check active. Only client-side `getTripRequestBlockedReason` enforces it.)
- [ ] Prevent inactive/unverified boats from being used on trips. (`boats` has no `active`/`verified` column and `create_fisherman_trip_request` does not check one.)
- [ ] Prevent disabled or stale devices from being used for new trip approvals. (`create_fisherman_trip_request` checks device ownership but not `devices.active` or staleness; only `trigger_fisherman_sos` checks `active`.)
- [ ] Prevent overlapping active trips for the same fisherman, boat, or device. (`create_fisherman_trip_request` only blocks overlap on `captain_id`, not `boat_id` or `device_id`.)
- [x] Require `expected_return` and destination/fishing area before BMU approval. (Enforced client-side in fisherman.tsx via `getTripRequestBlockedReason`; DB columns are nullable and the RPC does not re-validate.)
- [x] Define allowed trip transitions, for example `pending_approval -> at_sea -> returned`, `pending_approval -> cancelled` (captain withdraws request), `at_sea -> sos -> rescue_in_progress -> rescued/returned`, `sos -> at_sea` (false-alarm cancel), and `at_sea -> overdue`. (`TRIP_STATUS_TRANSITIONS` in lib/trip-status.ts + `ensure_trip_transition()` trigger + `bmu_transition_trip`.)
- [x] Define allowed SOS transitions, for example `new -> acknowledged -> assigned -> in_progress -> resolved -> closed`, and `new/acknowledged/assigned/in_progress -> closed` (false-alarm cancel with reason). (`ensure_alert_transition()` trigger in `20260714000000_workflow_enforcement.sql`.)
- [ ] Enforce fisherman-driven SOS cancellation rules in DB/RPC (see **Fisherman Cancel & State Restoration**): auto-mark fisherman-initiated cancels as false alarms; notify rescue if already acknowledged/assigned. (Auto false-alarm marking done in `cancel_fisherman_sos`; rescue notification on cancel is NOT implemented — same gap as Cancel & Restore #8.)
- [ ] Require rescue closure notes, outcome, assigned team, and timestamps before an incident can be fully closed. (`close_rescue_operation` requires `p_notes`; team set on assign; timestamps auto — but there is no `outcome` field.)
- [ ] Keep historical trips, alerts, GPS logs, and rescue operations immutable or soft-deleted only. (Cancel/transition flows only `UPDATE`, but BMU officers can still `DELETE` fishermen/boats/devices via `manage_bmu_*`/`bmus` delete — no soft-delete.)
- [ ] Add post-incident review visibility for BMU officers and admins. (No dedicated review UI; `sos_alerts` is readable by `bmu_officer`/`admin` but only the rescue dashboard renders incidents.)

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

- [x] Make the test suite runnable at all. (There was no `test` script and no runner; the four `*.test.ts` files had never been executed, and two of them asserted behaviour the code did not have. `scripts/run-tests.mjs` transpiles with the TypeScript compiler already in `devDependencies` — Node on several distros is built without TypeScript support, so `node --test` on `.ts` fails outright.)
- [x] Add hardware ingest failure-matrix tests. (`src/lib/ingest-core.test.ts` — 28 cases: valid SOS, no-fix SOS, `0,0` SOS, duplicate SOS, replayed `event_id`, multiple open alerts, missing/invalid secret, unknown device, disabled device on all three endpoints, malformed JSON, every out-of-range field, stale timestamp, storage failure → 503, error-detail leakage, rate limit, location linking, cancel, cancel-after-engagement notification, cancel storage failure.)
- [x] Add firmware parser tests. (`firmware/test/test_at_parse.cpp` — 36 checks over `+HTTPACTION`, `+SAPBR`, `+CREG` and the retry policy, compiled natively by `npm run test:firmware`.)
- [ ] Normalize line endings / formatting so `npm run lint` passes. (Pre-existing: 437 problems at the start of this work, now 375, essentially all `prettier/prettier` in `auth.tsx`, `index.tsx`, `bmu.tsx`, `rescue.tsx` and `fisherman.tsx`. Fixing it is a whole-repo reformat and was kept out of this change set so the diff stays reviewable; run `npm run format` in a commit of its own.)
- [ ] Add RLS/RPC permission tests for fisherman, BMU officer, rescue officer, and admin users. (Needs a live Postgres; the current suites are pure-unit and run without a database.)
- [ ] Add workflow tests for trip request, BMU approval, captain cancel trip request, SOS trigger, rescue assignment, fisherman SOS cancel (restores trip to `at_sea`), hardware SOS cancel, and rescue resolution.
- [x] Update `README.md` and `HARDWARE_INTEGRATION.md` with the final provisioning and security model. (HARDWARE_INTEGRATION.md rewritten against the actual firmware, with a "Changes from the previous revision" table listing what the old guide claimed but the code never did.)
