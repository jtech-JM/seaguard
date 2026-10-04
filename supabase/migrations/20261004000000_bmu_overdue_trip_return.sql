CREATE OR REPLACE FUNCTION public.bmu_transition_trip(
  p_trip_id uuid,
  p_target_status public.trip_status,
  p_reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile_id uuid := auth.uid();
  v_current_status public.trip_status;
BEGIN
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.has_role(v_profile_id, 'bmu_officer') THEN
    RAISE EXCEPTION 'Only BMU officers can change trip status';
  END IF;

  IF p_target_status = 'cancelled' AND COALESCE(TRIM(p_reason), '') = '' THEN
    RAISE EXCEPTION 'A cancellation reason is required';
  END IF;

  SELECT status
    INTO v_current_status
    FROM public.sea_trips
   WHERE id = p_trip_id;

  IF v_current_status IS NULL THEN
    RAISE EXCEPTION 'Trip not found';
  END IF;

  IF (v_current_status = 'pending_approval' AND p_target_status NOT IN ('at_sea', 'cancelled'))
     OR (v_current_status = 'at_sea' AND p_target_status <> 'overdue')
     OR (v_current_status = 'overdue' AND p_target_status NOT IN ('overdue', 'returned')) THEN
    RAISE EXCEPTION 'Invalid trip transition';
  END IF;

  UPDATE public.sea_trips
     SET status = p_target_status,
         actual_departure = CASE
           WHEN p_target_status = 'at_sea' AND actual_departure IS NULL THEN now()
           ELSE actual_departure
         END,
         actual_return = CASE
           WHEN p_target_status = 'returned' AND actual_return IS NULL THEN now()
           ELSE actual_return
         END
   WHERE id = p_trip_id;

  PERFORM public.log_audit_event(
    'trip_status_changed',
    'sea_trip',
    p_trip_id,
    jsonb_build_object(
      'from_status', v_current_status,
      'to_status', p_target_status,
      'reason', p_reason
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.bmu_transition_trip(uuid, public.trip_status, text) TO authenticated;
