-- ============================================================
-- Migration: overdue auto-detection + realtime for more tables
-- ============================================================

-- 1. Function: mark at-sea trips with passed expected_return as overdue
-- Called by a pg_cron job every 5 minutes (schedule set in Supabase dashboard
-- under Database → Extensions → pg_cron, or via the SQL below if pg_cron is enabled).
CREATE OR REPLACE FUNCTION public.mark_overdue_trips()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.sea_trips
  SET    status     = 'overdue',
         updated_at = now()
  WHERE  status          = 'at_sea'
    AND  expected_return < now()
    AND  expected_return IS NOT NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_overdue_trips() TO service_role;

-- 2. Schedule via pg_cron if the extension is available
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'
  ) THEN
    PERFORM cron.schedule(
      'mark-overdue-trips',   -- job name (idempotent)
      '*/5 * * * *',          -- every 5 minutes
      'SELECT public.mark_overdue_trips()'
    );
  END IF;
END;
$$;

-- 3. Realtime: add tables only if not already members of the publication
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['sea_trips','trip_crew','profiles'] LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM   pg_publication_tables
      WHERE  pubname   = 'supabase_realtime'
        AND  schemaname = 'public'
        AND  tablename  = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END;
$$;
