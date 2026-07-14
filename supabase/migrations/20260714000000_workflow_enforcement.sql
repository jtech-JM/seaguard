CREATE OR REPLACE FUNCTION public.ensure_trip_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  allowed boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'pending_approval' THEN
      RETURN NEW;
    END IF;
    IF NEW.status = 'at_sea' AND NEW.actual_departure IS NOT NULL THEN
      RETURN NEW;
    END IF;
  END IF;

  IF OLD.status = 'pending_approval' AND NEW.status IN ('at_sea', 'cancelled') THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'at_sea' AND NEW.status IN ('returned', 'sos', 'overdue') THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'sos' AND NEW.status IN ('rescue_in_progress', 'at_sea') THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'rescue_in_progress' AND NEW.status IN ('rescued', 'at_sea') THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'rescued' AND NEW.status = 'returned' THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Invalid trip status transition from % to %', OLD.status, NEW.status;
END;
$$;

DROP TRIGGER IF EXISTS trg_trip_transition_check ON public.sea_trips;
CREATE TRIGGER trg_trip_transition_check
BEFORE UPDATE ON public.sea_trips
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION public.ensure_trip_transition();

CREATE OR REPLACE FUNCTION public.ensure_alert_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.status = 'new' AND NEW.status IN ('acknowledged', 'closed') THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'acknowledged' AND NEW.status IN ('assigned', 'in_progress', 'closed') THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'assigned' AND NEW.status IN ('in_progress', 'resolved', 'closed') THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'in_progress' AND NEW.status IN ('resolved', 'closed') THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'resolved' AND NEW.status = 'closed' THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Invalid alert status transition from % to %', OLD.status, NEW.status;
END;
$$;

DROP TRIGGER IF EXISTS trg_alert_transition_check ON public.sos_alerts;
CREATE TRIGGER trg_alert_transition_check
BEFORE UPDATE ON public.sos_alerts
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION public.ensure_alert_transition();
