-- ============================================================
-- Captain certification
-- Adds is_certified_captain + captain_license_number to fishermen.
-- Certification is permanent (no expiry).
-- BMU officers set/update it via manage_bmu_fisherman (action=update).
-- create_fisherman_trip_request enforces it at trip submission time.
-- ============================================================

-- 1. Add columns (default false so existing fishermen are unaffected)
ALTER TABLE public.fishermen
  ADD COLUMN IF NOT EXISTS is_certified_captain BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS captain_license_number TEXT;

-- 2. Update manage_bmu_fisherman to accept and persist certification fields
CREATE OR REPLACE FUNCTION public.manage_bmu_fisherman(
  p_action                  text,
  p_id                      uuid    DEFAULT NULL,
  p_full_name               text    DEFAULT NULL,
  p_phone                   text    DEFAULT NULL,
  p_national_id             text    DEFAULT NULL,
  p_emergency_contact_name  text    DEFAULT NULL,
  p_emergency_contact_phone text    DEFAULT NULL,
  p_photo_url               text    DEFAULT NULL,
  p_active                  boolean DEFAULT true,
  p_bmu_id                  uuid    DEFAULT NULL,
  -- new certification params (backwards-compatible defaults)
  p_is_certified_captain    boolean DEFAULT NULL,
  p_captain_license_number  text    DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile_id   uuid := auth.uid();
  v_fisherman_id uuid;
BEGIN
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.has_role(v_profile_id, 'bmu_officer') THEN
    RAISE EXCEPTION 'Only BMU officers can manage fishermen';
  END IF;

  IF p_action = 'create' THEN
    INSERT INTO public.fishermen (
      full_name,
      phone,
      national_id,
      emergency_contact_name,
      emergency_contact_phone,
      photo_url,
      active,
      bmu_id,
      is_certified_captain,
      captain_license_number
    )
    VALUES (
      COALESCE(p_full_name, ''),
      p_phone,
      p_national_id,
      p_emergency_contact_name,
      p_emergency_contact_phone,
      p_photo_url,
      COALESCE(p_active, true),
      p_bmu_id,
      COALESCE(p_is_certified_captain, false),
      p_captain_license_number
    )
    RETURNING id INTO v_fisherman_id;
    RETURN v_fisherman_id;

  ELSIF p_action = 'update' THEN
    IF p_id IS NULL THEN
      RAISE EXCEPTION 'Missing fisherman id';
    END IF;

    UPDATE public.fishermen
       SET full_name               = COALESCE(p_full_name, full_name),
           phone                   = p_phone,
           national_id             = p_national_id,
           emergency_contact_name  = p_emergency_contact_name,
           emergency_contact_phone = p_emergency_contact_phone,
           photo_url               = p_photo_url,
           active                  = COALESCE(p_active, active),
           bmu_id                  = p_bmu_id,
           -- only update certification when the caller explicitly passes a value
           is_certified_captain    = COALESCE(p_is_certified_captain, is_certified_captain),
           captain_license_number  = COALESCE(p_captain_license_number, captain_license_number)
     WHERE id = p_id;
    RETURN p_id;

  ELSIF p_action = 'delete' THEN
    IF p_id IS NULL THEN
      RAISE EXCEPTION 'Missing fisherman id';
    END IF;

    DELETE FROM public.fishermen WHERE id = p_id;
    RETURN p_id;

  ELSE
    RAISE EXCEPTION 'Unsupported fisherman action: %', p_action;
  END IF;
END;
$$;

-- Re-grant (signature changed — old grant still works but re-grant is safe)
GRANT EXECUTE ON FUNCTION public.manage_bmu_fisherman(
  text, uuid, text, text, text, text, text, text, boolean, uuid, boolean, text
) TO authenticated;

-- 3. Enforce certification at trip creation
CREATE OR REPLACE FUNCTION public.create_fisherman_trip_request(
  p_boat_id        uuid,
  p_device_id      uuid,
  p_destination    text,
  p_fishing_area   text,
  p_expected_return timestamptz,
  p_notes          text,
  p_crew_ids       uuid[]
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

  -- ── Certification check (new) ────────────────────────────────
  IF NOT EXISTS (
    SELECT 1 FROM public.fishermen
     WHERE id = v_fisherman_id
       AND is_certified_captain = true
  ) THEN
    RAISE EXCEPTION 'Only certified captains can submit a trip request';
  END IF;

  -- ── Existing active-trip guard ───────────────────────────────
  IF EXISTS (
    SELECT 1
      FROM public.sea_trips
     WHERE captain_id = v_fisherman_id
       AND status IN (
         'pending_approval', 'checked_out', 'at_sea',
         'sos', 'rescue_in_progress', 'overdue'
       )
  ) THEN
    RAISE EXCEPTION 'You already have an active trip';
  END IF;

  -- ── Ownership checks ─────────────────────────────────────────
  IF p_boat_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.boats
     WHERE id = p_boat_id
       AND owner_fisherman_id = v_fisherman_id
  ) THEN
    RAISE EXCEPTION 'Boat does not belong to this fisherman';
  END IF;

  IF p_device_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
      FROM public.devices d
      JOIN public.boats   b ON b.id = d.boat_id
     WHERE d.id = p_device_id
       AND b.owner_fisherman_id = v_fisherman_id
  ) THEN
    RAISE EXCEPTION 'Device does not belong to this fisherman';
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
