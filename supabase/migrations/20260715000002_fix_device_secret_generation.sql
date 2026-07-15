-- ============================================================
-- Fix device secret generation in manage_bmu_device.
-- gen_random_bytes() requires pgcrypto which is not enabled.
-- Use md5(random() || clock_timestamp()) instead — same
-- approach as the pre-existing manage_bmu_device versions.
-- ============================================================

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
BEGIN
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.has_role(v_profile_id, 'bmu_officer') THEN
    RAISE EXCEPTION 'Only BMU officers can manage devices';
  END IF;

  IF p_action = 'create' THEN
    IF p_fisherman_id IS NULL THEN
      RAISE EXCEPTION 'A device must be assigned to a fisherman before it can be created';
    END IF;

    -- Two md5 blocks concatenated → 64-char hex secret, no extension required
    v_secret := md5(random()::text || clock_timestamp()::text)
             || md5(random()::text || clock_timestamp()::text);

    INSERT INTO public.devices (device_id, fisherman_id, hardware_type, active, device_secret)
    VALUES (p_device_id, p_fisherman_id, p_hardware_type, COALESCE(p_active, true), v_secret)
    RETURNING id INTO v_device_uuid;

    RETURN jsonb_build_object('id', v_device_uuid, 'device_secret', v_secret);

  ELSIF p_action = 'update' THEN
    IF p_id IS NULL THEN
      RAISE EXCEPTION 'Missing device id';
    END IF;

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

GRANT EXECUTE ON FUNCTION public.manage_bmu_device(
  text, uuid, text, uuid, text, boolean, text
) TO authenticated;
