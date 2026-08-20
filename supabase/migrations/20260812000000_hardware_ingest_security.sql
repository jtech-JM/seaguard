-- ============================================================
-- Hardware ingest security and reliability
--
-- 1. Hash device secrets (SHA-256) and stop exposing them to browsers
-- 2. Generate secrets with a CSPRNG instead of md5(random())
-- 3. Device secret rotation, for compromised or lost credentials
-- 4. Idempotency key on sos_alerts so a retried SOS cannot duplicate an incident
-- 5. Atomic hardware cancel (alert + rescue operation + trip, one transaction)
-- 6. Trace id on the ingest audit log
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ------------------------------------------------------------
-- 1 + 2. Device secrets: hashed at rest, CSPRNG at generation
--
-- Secrets were stored in plaintext AND generated with md5(random()).
-- Postgres' random() is a seeded PRNG, not cryptographically secure: an
-- attacker who can observe or influence one session's sequence can predict
-- other secrets. A predicted secret forges SOS events and — worse — forges
-- /cancel calls that close a real distress alert.
--
-- The plaintext column is retained but revoked for one release so the change
-- can be rolled back; it is dropped in a follow-up once the fleet is verified.
-- ------------------------------------------------------------
ALTER TABLE public.devices
  ADD COLUMN IF NOT EXISTS device_secret_hash text,
  ADD COLUMN IF NOT EXISTS device_secret_rotated_at timestamptz;

-- Backfill from the existing plaintext so already-deployed devices keep working
-- without being re-flashed.
UPDATE public.devices
   SET device_secret_hash = encode(extensions.digest(device_secret, 'sha256'), 'hex')
 WHERE device_secret_hash IS NULL
   AND device_secret IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_devices_device_id ON public.devices(device_id);

-- Browsers must never receive either form of the secret. Column-level REVOKE
-- applies underneath RLS: the "devices read scoped" policy previously handed
-- device_secret to every admin, BMU officer AND rescue officer session.
REVOKE SELECT (device_secret) ON public.devices FROM authenticated;
REVOKE SELECT (device_secret_hash) ON public.devices FROM authenticated;
REVOKE SELECT ON public.devices FROM anon;

CREATE OR REPLACE FUNCTION public.generate_device_secret()
RETURNS text
LANGUAGE sql
VOLATILE
SET search_path = public
AS $$
  -- 32 CSPRNG bytes -> 64 hex characters.
  SELECT encode(extensions.gen_random_bytes(32), 'hex');
$$;

-- ------------------------------------------------------------
-- 3. Provisioning + rotation
--
-- The plaintext secret is returned exactly once, by the call that generates it.
-- It cannot be read back afterwards; a lost secret is replaced by rotating,
-- which is also the remediation when a secret leaks (for example by being
-- committed to a firmware source file).
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
      device_secret, device_secret_hash, device_secret_rotated_at
    )
    VALUES (
      p_device_id, p_fisherman_id, p_hardware_type, COALESCE(p_active, true),
      v_secret, encode(extensions.digest(v_secret, 'sha256'), 'hex'), now()
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

  -- Rotation invalidates the credential flashed on the hardware, so the reason
  -- is recorded: the device stops reporting until it is re-flashed.
  IF p_reason IS NULL OR trim(p_reason) = '' THEN
    RAISE EXCEPTION 'A reason is required when rotating a device secret';
  END IF;

  v_secret := public.generate_device_secret();

  UPDATE public.devices
     SET device_secret            = v_secret,
         device_secret_hash       = encode(extensions.digest(v_secret, 'sha256'), 'hex'),
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
-- 4. SOS idempotency
--
-- A device that transmits an SOS, loses the response and retries must land on
-- the same incident. Deduplicating on "any open alert" is not enough: if the
-- alert is closed between the send and the retry, the retry opens a second
-- incident for an emergency that is already over.
-- ------------------------------------------------------------
ALTER TABLE public.sos_alerts
  ADD COLUMN IF NOT EXISTS ingest_event_id text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_sos_alerts_device_event
  ON public.sos_alerts(device_id, ingest_event_id)
  WHERE ingest_event_id IS NOT NULL;

-- ------------------------------------------------------------
-- 5. Atomic hardware cancel
--
-- The previous route issued three independent writes (close alerts, close
-- rescue operations, restore the trip). A failure between them left the system
-- half-cancelled: an alert closed on the dashboard while its rescue operation
-- stayed open, or a trip stuck in `sos` with no alert behind it.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.hardware_cancel_sos(
  p_alert_ids   uuid[],
  p_fisherman_id uuid,
  p_reason      text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reason   text := COALESCE(NULLIF(trim(p_reason), ''), 'Cancelled from device');
  v_closed   int  := 0;
BEGIN
  IF p_alert_ids IS NULL OR array_length(p_alert_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('closed', 0);
  END IF;

  UPDATE public.sos_alerts
     SET status      = 'closed',
         resolved_at = now(),
         notes       = concat_ws(E'\n', NULLIF(notes, ''), 'False alarm reason: ' || v_reason)
   WHERE id = ANY(p_alert_ids)
     AND status IN ('new', 'acknowledged', 'assigned', 'in_progress');
  GET DIAGNOSTICS v_closed = ROW_COUNT;

  UPDATE public.rescue_operations
     SET status   = 'closed',
         ended_at = COALESCE(ended_at, now()),
         notes    = concat_ws(E'\n', NULLIF(notes, ''), 'False alarm reason: ' || v_reason)
   WHERE alert_id = ANY(p_alert_ids)
     AND ended_at IS NULL;

  -- Restore the trip to the state it was in before the SOS. Historical rows
  -- (gps_logs, closed alerts, trip_status_history) are never touched.
  IF p_fisherman_id IS NOT NULL THEN
    UPDATE public.sea_trips
       SET status = 'at_sea'
     WHERE captain_id = p_fisherman_id
       AND status IN ('sos', 'rescue_in_progress');
  END IF;

  RETURN jsonb_build_object('closed', v_closed);
END;
$$;

-- Called only by the service role from the ingest endpoints, which authenticate
-- the device before reaching it. No grant to `authenticated`: browser clients
-- cancel through cancel_fisherman_sos, which enforces ownership.
REVOKE ALL ON FUNCTION public.hardware_cancel_sos(uuid[], uuid, text) FROM PUBLIC;

-- ------------------------------------------------------------
-- 6. Ingest audit log: trace id
--
-- Every ingest request carries a trace id, returned to the caller in the
-- x-seaguard-trace header, so a device event can be followed through the API
-- into the database and on to the dashboard.
-- ------------------------------------------------------------
ALTER TABLE public.ingest_request_logs
  ADD COLUMN IF NOT EXISTS trace_id text;

CREATE INDEX IF NOT EXISTS idx_ingest_logs_created ON public.ingest_request_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ingest_logs_device ON public.ingest_request_logs(device_id);

-- The ingest core passes the trace id in the p_nonce slot of the existing
-- signature; store it in both columns so old and new readers agree.
CREATE OR REPLACE FUNCTION public.log_ingest_request(
  p_device_id     text,
  p_source_ip     text,
  p_endpoint      text,
  p_nonce         text,
  p_status_code   int,
  p_error_message text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.ingest_request_logs (
    device_id, source_ip, endpoint, nonce, trace_id, status_code, error_message
  ) VALUES (
    p_device_id, p_source_ip, p_endpoint, p_nonce, p_nonce, p_status_code, p_error_message
  );
END;
$$;

REVOKE ALL ON FUNCTION public.log_ingest_request(text, text, text, text, int, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.log_ingest_request(text, text, text, text, int, text) FROM authenticated;
