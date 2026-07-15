-- ============================================================
-- Device → Fisherman assignment
--
-- Devices are wearable rescue watches issued to individual
-- fishermen (captain or crew).  They are NOT boat-mounted.
--
-- Changes:
--   1. Add devices.fisherman_id  (FK → fishermen.id)
--   2. Migrate any existing boat→owner_fisherman links
--   3. Drop devices.boat_id
--   4. Update manage_bmu_device RPC (boat_id → fisherman_id)
--   5. Update trigger_fisherman_sos: ownership check via
--      devices.fisherman_id instead of boat chain
--   6. Update hardware ingest: fisherman/bmu resolved from
--      devices.fisherman_id directly; boat_id on sos_alerts
--      sourced from the active sea_trip at trigger time
-- ============================================================

-- 1. Add fisherman_id column
ALTER TABLE public.devices
  ADD COLUMN IF NOT EXISTS fisherman_id uuid
    REFERENCES public.fishermen(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_devices_fisherman ON public.devices(fisherman_id);

-- 2. Migrate: copy owner_fisherman_id from the linked boat
UPDATE public.devices d
   SET fisherman_id = b.owner_fisherman_id
  FROM public.boats b
 WHERE b.id = d.boat_id
   AND d.fisherman_id IS NULL;

-- 3. Drop old boat_id column (keep data in gps_logs / sos_alerts unchanged)
ALTER TABLE public.devices DROP COLUMN IF EXISTS boat_id;

-- 4. Update manage_bmu_device RPC
-- Must DROP the old signature first — Postgres won't allow renaming parameters
-- via CREATE OR REPLACE (SQLSTATE 42P13).
DROP FUNCTION IF EXISTS public.manage_bmu_device(text, uuid, text, uuid, text, boolean);
DROP FUNCTION IF EXISTS public.manage_bmu_device(text, uuid, text, uuid, text, boolean, text);

CREATE FUNCTION public.manage_bmu_device(
  p_action       text,
  p_id           uuid    DEFAULT NULL,
  p_device_id    text    DEFAULT NULL,
  p_fisherman_id uuid    DEFAULT NULL,   -- was p_boat_id
  p_hardware_type text   DEFAULT NULL,
  p_active       boolean DEFAULT true,
  p_reason       text    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile_id uuid := auth.uid();
  v_device_uuid uuid;
  v_secret      text;
BEGIN
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.has_role(v_profile_id, 'bmu_officer') THEN
    RAISE EXCEPTION 'Only BMU officers can manage devices';
  END IF;

  IF p_action = 'create' THEN
    -- A device must be assigned to a fisherman before it can be issued
    IF p_fisherman_id IS NULL THEN
      RAISE EXCEPTION 'A device must be assigned to a fisherman before it can be created';
    END IF;

    v_secret := encode(gen_random_bytes(24), 'hex');   -- 48-char hex secret

    INSERT INTO public.devices (device_id, fisherman_id, hardware_type, active, device_secret)
    VALUES (p_device_id, p_fisherman_id, p_hardware_type, COALESCE(p_active, true), v_secret)
    RETURNING id INTO v_device_uuid;

    RETURN jsonb_build_object('id', v_device_uuid, 'device_secret', v_secret);

  ELSIF p_action = 'update' THEN
    IF p_id IS NULL THEN
      RAISE EXCEPTION 'Missing device id';
    END IF;

    -- Require reason when disabling
    IF p_active = false AND (p_reason IS NULL OR trim(p_reason) = '') THEN
      RAISE EXCEPTION 'A reason is required when disabling a device';
    END IF;

    UPDATE public.devices
       SET device_id     = COALESCE(p_device_id, device_id),
           fisherman_id  = p_fisherman_id,
           hardware_type = p_hardware_type,
           active        = COALESCE(p_active, active)
     WHERE id = p_id;

    RETURN jsonb_build_object('id', p_id, 'device_secret', null);

  ELSIF p_action = 'delete' THEN
    IF p_id IS NULL THEN
      RAISE EXCEPTION 'Missing device id';
    END IF;

    DELETE FROM public.devices WHERE id = p_id;
    RETURN jsonb_build_object('id', p_id, 'device_secret', null);

  ELSE
    RAISE EXCEPTION 'Unsupported device action: %', p_action;
  END IF;
END;
$$;

-- Grant for new signature (fisherman_id instead of boat_id)
GRANT EXECUTE ON FUNCTION public.manage_bmu_device(
  text, uuid, text, uuid, text, boolean, text
) TO authenticated;

-- 5. Update trigger_fisherman_sos: validate device via fisherman_id directly
CREATE OR REPLACE FUNCTION public.trigger_fisherman_sos(
  p_device_id   uuid,
  p_lat         double precision,
  p_lng         double precision,
  p_accuracy    double precision,
  p_notes       text
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
  v_device_active boolean;
  v_boat_id      uuid;
  v_alert_id     uuid;
BEGIN
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.has_role(v_profile_id, 'fisherman') THEN
    RAISE EXCEPTION 'Only fishermen can trigger SOS';
  END IF;

  SELECT fisherman_id, bmu_id
    INTO v_fisherman_id, v_bmu_id
    FROM public.profiles
   WHERE id = v_profile_id;

  IF v_fisherman_id IS NULL THEN
    RAISE EXCEPTION 'Profile is not linked to a fisherman record';
  END IF;

  -- Device must be assigned directly to this fisherman
  SELECT active
    INTO v_device_active
    FROM public.devices
   WHERE id = p_device_id
     AND fisherman_id = v_fisherman_id;

  IF v_device_active IS NULL THEN
    RAISE EXCEPTION 'Device is not assigned to this fisherman';
  END IF;

  IF NOT v_device_active THEN
    RAISE EXCEPTION 'Device is disabled';
  END IF;

  -- Best-effort: get the boat from the fisherman's active trip
  SELECT boat_id
    INTO v_boat_id
    FROM public.sea_trips
   WHERE captain_id = v_fisherman_id
     AND status IN ('pending_approval', 'checked_out', 'at_sea', 'sos',
                    'rescue_in_progress', 'overdue')
   ORDER BY created_at DESC
   LIMIT 1;

  INSERT INTO public.sos_alerts (
    device_id, boat_id, fisherman_id, bmu_id,
    status, last_lat, last_lng, last_accuracy,
    last_ping_at, notes, emergency_level
  )
  VALUES (
    p_device_id, v_boat_id, v_fisherman_id, v_bmu_id,
    'new', p_lat, p_lng, p_accuracy,
    now(), COALESCE(p_notes, 'Triggered via software client'), 'HIGH'
  )
  RETURNING id INTO v_alert_id;

  INSERT INTO public.gps_logs (alert_id, device_id, lat, lng, accuracy)
  VALUES (v_alert_id, p_device_id, p_lat, p_lng, p_accuracy);

  -- Escalate the active trip to SOS status
  UPDATE public.sea_trips
     SET status = 'sos'
   WHERE captain_id = v_fisherman_id
     AND status IN ('pending_approval', 'checked_out', 'at_sea',
                    'sos', 'rescue_in_progress', 'overdue');

  RETURN v_alert_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.trigger_fisherman_sos(
  uuid, double precision, double precision, double precision, text
) TO authenticated;
