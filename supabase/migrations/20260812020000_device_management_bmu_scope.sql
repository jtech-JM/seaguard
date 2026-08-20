-- ============================================================
-- Scope device management to the officer's own BMU
--
-- manage_bmu_device and rotate_bmu_device_secret checked only that the caller
-- holds the bmu_officer role, never *which* BMU they belong to. Any officer
-- could therefore reassign, disable, delete or re-key a device belonging to any
-- other BMU. Rotating another BMU's device secret is the sharpest form of that:
-- it silently takes a working distress beacon off the air until someone notices
-- and re-flashes it.
--
-- A device's BMU is derived through its assigned fisherman
-- (devices.fisherman_id -> fishermen.bmu_id). An officer's BMU is
-- profiles.bmu_id.
--
-- BEFORE APPLYING: every bmu_officer needs profiles.bmu_id populated, or they
-- lose device management entirely. Check with:
--
--   SELECT p.id, p.email
--     FROM public.profiles p
--     JOIN public.user_roles ur ON ur.user_id = p.id
--    WHERE ur.role = 'bmu_officer' AND p.bmu_id IS NULL;
--
-- The functions fail closed on an unlinked officer and say so explicitly,
-- rather than falling back to unrestricted access.
--
-- Admins are unrestricted, as they are elsewhere in the schema.
-- ============================================================

-- ------------------------------------------------------------
-- The BMU a device belongs to, or NULL when it has no fisherman assigned.
--
-- Unassigned devices are legacy only — manage_bmu_device('create') has required
-- a fisherman since 20260715000001 — and have no BMU boundary to cross, so any
-- officer may adopt one.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.device_bmu_id(p_device_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT f.bmu_id
    FROM public.devices d
    LEFT JOIN public.fishermen f ON f.id = d.fisherman_id
   WHERE d.id = p_device_id;
$$;

REVOKE ALL ON FUNCTION public.device_bmu_id(uuid) FROM PUBLIC;

-- ------------------------------------------------------------
-- Raises unless the caller may manage devices in p_target_bmu_id.
-- NULL target = an unassigned device, which any officer may take on.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assert_can_manage_device_bmu(p_target_bmu_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile_id  uuid := auth.uid();
  v_officer_bmu uuid;
BEGIN
  IF public.has_role(v_profile_id, 'admin') THEN
    RETURN;
  END IF;

  SELECT bmu_id INTO v_officer_bmu FROM public.profiles WHERE id = v_profile_id;

  IF v_officer_bmu IS NULL THEN
    RAISE EXCEPTION
      'Your account is not linked to a BMU, so it cannot manage devices. Ask an administrator to set it.';
  END IF;

  IF p_target_bmu_id IS NOT NULL AND p_target_bmu_id <> v_officer_bmu THEN
    RAISE EXCEPTION 'This device belongs to another BMU';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_can_manage_device_bmu(uuid) FROM PUBLIC;

-- ------------------------------------------------------------
-- manage_bmu_device, scoped
--
-- Note on 'update' semantics, unchanged and deliberate: this is a full replace,
-- not a partial patch. The console's device form posts every field on each save
-- and clearing the fisherman selector is how a device is unassigned, so
-- fisherman_id and hardware_type are written as given — including NULL. Only
-- device_id and active are COALESCEd, because device_id is NOT NULL and active
-- has no "clear" state. Callers must send the complete record.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.manage_bmu_device(
  p_action        text,
  p_id            uuid    DEFAULT NULL,
  p_device_id     text    DEFAULT NULL,
  p_fisherman_id  uuid    DEFAULT NULL,
  p_hardware_type text    DEFAULT NULL,
  p_active        boolean DEFAULT true,
  p_reason        text    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile_id  uuid := auth.uid();
  v_device_uuid uuid;
  v_secret      text;
  v_target_bmu  uuid;
BEGIN
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Unchanged from the previous definition: device CRUD is a BMU officer's job,
  -- so this is not widened to admins here.
  IF NOT public.has_role(v_profile_id, 'bmu_officer') THEN
    RAISE EXCEPTION 'Only BMU officers can manage devices';
  END IF;

  IF p_action = 'create' THEN
    IF p_fisherman_id IS NULL THEN
      RAISE EXCEPTION 'A device must be assigned to a fisherman before it can be created';
    END IF;

    -- Scope on the fisherman being assigned: creating a device inside another
    -- BMU is the same boundary crossing as editing one.
    SELECT bmu_id INTO v_target_bmu FROM public.fishermen WHERE id = p_fisherman_id;
    PERFORM public.assert_can_manage_device_bmu(v_target_bmu);

    v_secret := public.generate_device_secret();

    INSERT INTO public.devices (
      device_id, fisherman_id, hardware_type, active,
      device_secret_hash, device_secret_rotated_at
    )
    VALUES (
      p_device_id, p_fisherman_id, p_hardware_type, COALESCE(p_active, true),
      encode(extensions.digest(v_secret, 'sha256'), 'hex'), now()
    )
    RETURNING id INTO v_device_uuid;

    RETURN jsonb_build_object('id', v_device_uuid, 'device_secret', v_secret);

  ELSIF p_action = 'update' THEN
    IF p_id IS NULL THEN
      RAISE EXCEPTION 'Missing device id';
    END IF;

    IF p_active = false AND (p_reason IS NULL OR trim(p_reason) = '') THEN
      RAISE EXCEPTION 'A reason is required when disabling a device';
    END IF;

    -- Both ends of a reassignment are checked: an officer may not take a device
    -- from another BMU, nor push one of theirs into somebody else's.
    PERFORM public.assert_can_manage_device_bmu(public.device_bmu_id(p_id));
    IF p_fisherman_id IS NOT NULL THEN
      SELECT bmu_id INTO v_target_bmu FROM public.fishermen WHERE id = p_fisherman_id;
      PERFORM public.assert_can_manage_device_bmu(v_target_bmu);
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

    PERFORM public.assert_can_manage_device_bmu(public.device_bmu_id(p_id));

    DELETE FROM public.devices WHERE id = p_id;
    RETURN jsonb_build_object('id', p_id, 'device_secret', null);

  ELSE
    RAISE EXCEPTION 'Unsupported device action: %', p_action;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.manage_bmu_device(
  text, uuid, text, uuid, text, boolean, text
) TO authenticated;

-- ------------------------------------------------------------
-- rotate_bmu_device_secret, scoped
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rotate_bmu_device_secret(
  p_id     uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile_id uuid := auth.uid();
  v_secret     text;
  v_device_id  text;
BEGIN
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.has_role(v_profile_id, 'bmu_officer')
     AND NOT public.has_role(v_profile_id, 'admin') THEN
    RAISE EXCEPTION 'Only BMU officers or admins can rotate device secrets';
  END IF;

  IF p_reason IS NULL OR trim(p_reason) = '' THEN
    RAISE EXCEPTION 'A reason is required when rotating a device secret';
  END IF;

  -- Checked before the device is confirmed to exist, so a caller outside the
  -- BMU cannot use the "Device not found" branch to probe for device ids.
  PERFORM public.assert_can_manage_device_bmu(public.device_bmu_id(p_id));

  v_secret := public.generate_device_secret();

  UPDATE public.devices
     SET device_secret_hash       = encode(extensions.digest(v_secret, 'sha256'), 'hex'),
         device_secret_rotated_at = now()
   WHERE id = p_id
  RETURNING device_id INTO v_device_id;

  IF v_device_id IS NULL THEN
    RAISE EXCEPTION 'Device not found';
  END IF;

  PERFORM public.log_audit_event(
    'device_secret_rotated', 'device', p_id,
    jsonb_build_object('device_id', v_device_id, 'reason', p_reason)
  );

  RETURN jsonb_build_object('id', p_id, 'device_id', v_device_id, 'device_secret', v_secret);
END;
$$;

GRANT EXECUTE ON FUNCTION public.rotate_bmu_device_secret(uuid, text) TO authenticated;
