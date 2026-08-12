-- ============================================================
-- Device secrets: make the revoke actually take effect, and drop the plaintext
--
-- 20260812000000 tried to hide the secret columns from browsers with:
--
--   REVOKE SELECT (device_secret) ON public.devices FROM authenticated;
--
-- That does not work. 20260625052152 granted SELECT at the *table* level, and
-- in PostgreSQL a column-level REVOKE does not carve a hole out of a table-level
-- grant — the two are tracked separately and access is the union of both. The
-- table grant kept every column readable, so the secret was still being served:
-- the fisherman portal selected `*` from devices, and "devices read scoped"
-- (20260715000003) lets a fisherman read their own row.
--
-- The working form is to revoke the table-level privilege and then grant back
-- only the columns browsers are allowed to see.
--
-- Consequence, deliberate: per-column grants make `SELECT *` on devices fail
-- outright for `authenticated` rather than silently omitting columns. Every
-- browser-side query against devices must name its columns.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Stop writing the plaintext secret
--
-- Both functions returned the freshly generated secret to the caller *and*
-- stored a copy in devices.device_secret. Only the hash is ever used to
-- authenticate (see src/lib/ingest-store.ts findDevice), so the stored copy was
-- pure liability: rotating a leaked credential just wrote a new plaintext
-- secret into a column browsers could read.
--
-- The plaintext is now shown exactly once, in the RPC result, and never
-- persisted. A secret that is lost after that point cannot be recovered — it is
-- replaced by rotating, which is the same remediation used when one leaks.
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

    -- Returned once, to the BMU officer who created the device. Not stored.
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

-- ------------------------------------------------------------
-- 2. Drop the plaintext column
--
-- Backfill defensively first: a device left with a NULL hash would be unable to
-- authenticate at all once the plaintext is gone, taking it offline silently.
-- ------------------------------------------------------------
UPDATE public.devices
   SET device_secret_hash = encode(extensions.digest(device_secret, 'sha256'), 'hex')
 WHERE device_secret_hash IS NULL
   AND device_secret IS NOT NULL;

ALTER TABLE public.devices DROP COLUMN IF EXISTS device_secret;

-- ------------------------------------------------------------
-- 3. Replace the table-level SELECT with per-column grants
--
-- device_secret_hash is deliberately absent from the grant list. It is not
-- directly usable as a credential — the ingest endpoints compare
-- sha256(presented) against it — but it is offline-crackable and nothing in the
-- UI needs it. The service role is unaffected and keeps full access, which is
-- how the ingest endpoints read it.
-- ------------------------------------------------------------
REVOKE SELECT ON public.devices FROM authenticated;
REVOKE SELECT ON public.devices FROM anon;
REVOKE SELECT ON public.devices FROM PUBLIC;

GRANT SELECT (
  id,
  device_id,
  fisherman_id,
  hardware_type,
  active,
  last_seen_at,
  assigned_at,
  created_at,
  updated_at,
  device_secret_rotated_at
) ON public.devices TO authenticated;
