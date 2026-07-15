-- ============================================================
-- When a rescue officer resolves or closes an alert,
-- restore the fisherman's trip back to 'at_sea' so everything
-- returns to normal — exactly as it was before the SOS.
--
-- Fisherman can then:
--   - Trigger a new SOS if another emergency happens
--   - Check in when they return to shore
--
-- Guard: only restore if trip is still in 'sos' or
-- 'rescue_in_progress'. If fisherman already checked in
-- (returned/cancelled) leave it alone.
--
-- Also fixes close_rescue_operation which was already
-- restoring to 'at_sea' — confirmed correct, no change needed
-- there. Only update_alert_status was missing this.
-- ============================================================

CREATE OR REPLACE FUNCTION public.update_alert_status(
  p_alert_id   uuid,
  p_next_status public.alert_status,
  p_notes      text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile_id     uuid := auth.uid();
  v_current_status public.alert_status;
BEGIN
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.has_role(v_profile_id, 'rescue_officer') THEN
    RAISE EXCEPTION 'Only rescue officers can change alert status';
  END IF;

  SELECT status INTO v_current_status
    FROM public.sos_alerts
   WHERE id = p_alert_id;

  IF v_current_status IS NULL THEN
    RAISE EXCEPTION 'Alert not found';
  END IF;

  IF (v_current_status = 'new'         AND p_next_status NOT IN ('acknowledged','assigned','closed'))
  OR (v_current_status = 'acknowledged' AND p_next_status NOT IN ('assigned','in_progress','closed'))
  OR (v_current_status = 'assigned'    AND p_next_status NOT IN ('in_progress','resolved','closed'))
  OR (v_current_status = 'in_progress' AND p_next_status NOT IN ('resolved','closed'))
  OR (v_current_status = 'resolved'    AND p_next_status NOT IN ('closed'))
  OR (v_current_status = 'closed'      AND p_next_status NOT IN ('closed'))
  THEN
    RAISE EXCEPTION 'Invalid alert transition from % to %', v_current_status, p_next_status;
  END IF;

  -- Update the alert
  UPDATE public.sos_alerts
     SET status         = p_next_status,
         acknowledged_at = CASE
           WHEN p_next_status IN ('acknowledged','assigned','in_progress','resolved','closed')
             AND acknowledged_at IS NULL
           THEN now()
           ELSE acknowledged_at
         END,
         resolved_at    = CASE
           WHEN p_next_status IN ('resolved','closed') AND resolved_at IS NULL
           THEN now()
           ELSE resolved_at
         END,
         notes          = concat_ws(E'\n', COALESCE(notes,''), COALESCE(p_notes,''))
   WHERE id = p_alert_id;

  -- ── Restore trip when incident is resolved or closed ────────
  -- Everything goes back to normal — exactly as before the SOS.
  -- Only touches trips still in distress state; leaves
  -- 'returned', 'cancelled', 'at_sea' etc. untouched.
  IF p_next_status IN ('resolved', 'closed') THEN
    UPDATE public.sea_trips
       SET status = 'at_sea'
     WHERE captain_id IN (
             SELECT fisherman_id
               FROM public.sos_alerts
              WHERE id = p_alert_id
           )
       AND status IN ('sos', 'rescue_in_progress');
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_alert_status(uuid, public.alert_status, text)
  TO authenticated;
