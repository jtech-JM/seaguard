
ALTER TABLE public.sos_alerts
  ADD COLUMN IF NOT EXISTS battery smallint,
  ADD COLUMN IF NOT EXISTS emergency_level text;

ALTER TABLE public.gps_logs
  ADD COLUMN IF NOT EXISTS battery smallint;
