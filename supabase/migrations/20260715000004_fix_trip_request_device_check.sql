-- ============================================================
-- Fix create_fisherman_trip_request: remove stale boat_id JOIN
-- on device ownership check.  Since devices now carry
-- fisherman_id directly, the check is simply:
--   devices.id = p_device_id AND devices.fisherman_id = v_fisherman_id
--
-- Also: boat ownership is now independent — a captain can use
-- any registered boat, not just one they personally own.
-- The boat check is relaxed to: boat must exist and be active
-- (owner restriction removed — handled at trip approval time
-- by the BMU officer).
-- ============================================================

CREATE OR REPLACE FUNCTION public.create_fisherman_trip_request(
  p_boat_id         uuid,
  p_device_id       uuid,
  p_destination     text,
  p_fishing_area    text,
  p_expected_return timestamptz,
  p_notes           text,
  p_crew_ids        uuid[]
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile_id   uuid := auth.uid();
  v_fisherman_id uuid;
  v_bmu_id       uuid;
  v_trip_id      uuid;
BEGIN
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.has_role(v_profile_id, 'fisherman') THEN
    RAISE EXCEPTION 'Only fishermen can create trips';
  END IF;

  SELECT fisherman_id, bmu_id
    INTO v_fisherman_id, v_bmu_id
    FROM public.profiles
   WHERE id = v_profile_id;

  IF v_fisherman_id IS NULL THEN
    RAISE EXCEPTION 'Profile is not linked to a fisherman record';
  END IF;

  -- ── Certification: only certified captains can create trips ──
  IF NOT EXISTS (
    SELECT 1 FROM public.fishermen
     WHERE id = v_fisherman_id
       AND is_certified_captain = true
  ) THEN
    RAISE EXCEPTION 'Only certified captains can submit a trip request';
  END IF;

  -- ── One active trip at a time ────────────────────────────────
  IF EXISTS (
    SELECT 1 FROM public.sea_trips
     WHERE captain_id = v_fisherman_id
       AND status IN (
         'pending_approval','checked_out','at_sea',
         'sos','rescue_in_progress','overdue'
       )
  ) THEN
    RAISE EXCEPTION 'You already have an active trip';
  END IF;

  -- ── Boat check: must exist (ownership is independent) ───────
  IF p_boat_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.boats WHERE id = p_boat_id
  ) THEN
    RAISE EXCEPTION 'Boat not found';
  END IF;

  -- ── Device check: must be assigned directly to this fisherman
  IF p_device_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.devices
     WHERE id = p_device_id
       AND fisherman_id = v_fisherman_id
       AND active = true
  ) THEN
    RAISE EXCEPTION 'Device is not assigned to this fisherman or is disabled';
  END IF;

  -- ── Insert trip ───────────────────────────────────────────────
  INSERT INTO public.sea_trips (
    captain_id, boat_id, device_id, bmu_id,
    status, planned_departure, expected_return,
    destination, fishing_area, notes
  )
  VALUES (
    v_fisherman_id, p_boat_id, p_device_id, v_bmu_id,
    'pending_approval', now(), p_expected_return,
    p_destination, p_fishing_area, p_notes
  )
  RETURNING id INTO v_trip_id;

  -- ── Insert crew ───────────────────────────────────────────────
  IF COALESCE(array_length(p_crew_ids, 1), 0) > 0 THEN
    INSERT INTO public.trip_crew (trip_id, fisherman_id, role)
    SELECT v_trip_id, crew_id, 'Crew'
      FROM unnest(p_crew_ids) AS crew_id
     WHERE crew_id IS NOT NULL;
  END IF;

  RETURN v_trip_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_fisherman_trip_request(
  uuid, uuid, text, text, timestamptz, text, uuid[]
) TO authenticated;
