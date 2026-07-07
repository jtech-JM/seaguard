
-- 1. Extend app_role enum
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'rescue_coordinator';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'fisherman';

-- 2. Default new users to 'fisherman'
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email), NEW.email)
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'fisherman')
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

-- 3. Link profiles → fishermen
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS fisherman_id uuid REFERENCES public.fishermen(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS bmu_id uuid REFERENCES public.bmus(id) ON DELETE SET NULL;

-- 4. Trip status enum
DO $$ BEGIN
  CREATE TYPE public.trip_status AS ENUM (
    'planned','pending_approval','checked_out','at_sea','sos',
    'rescue_in_progress','rescued','returned','overdue','cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 5. sea_trips
CREATE TABLE IF NOT EXISTS public.sea_trips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  captain_id uuid REFERENCES public.fishermen(id) ON DELETE SET NULL,
  boat_id uuid REFERENCES public.boats(id) ON DELETE SET NULL,
  device_id uuid REFERENCES public.devices(id) ON DELETE SET NULL,
  bmu_id uuid REFERENCES public.bmus(id) ON DELETE SET NULL,
  status public.trip_status NOT NULL DEFAULT 'planned',
  planned_departure timestamptz,
  actual_departure timestamptz,
  expected_return timestamptz,
  actual_return timestamptz,
  fishing_area text,
  destination text,
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sea_trips TO authenticated;
GRANT ALL ON public.sea_trips TO service_role;
ALTER TABLE public.sea_trips ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sea_trips read auth" ON public.sea_trips;
CREATE POLICY "sea_trips read auth" ON public.sea_trips FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "sea_trips write auth" ON public.sea_trips;
CREATE POLICY "sea_trips write auth" ON public.sea_trips FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS idx_sea_trips_status ON public.sea_trips(status);
CREATE INDEX IF NOT EXISTS idx_sea_trips_bmu ON public.sea_trips(bmu_id);
CREATE INDEX IF NOT EXISTS idx_sea_trips_captain ON public.sea_trips(captain_id);
DROP TRIGGER IF EXISTS trg_sea_trips_updated ON public.sea_trips;
CREATE TRIGGER trg_sea_trips_updated BEFORE UPDATE ON public.sea_trips
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 6. trip_crew
CREATE TABLE IF NOT EXISTS public.trip_crew (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL REFERENCES public.sea_trips(id) ON DELETE CASCADE,
  fisherman_id uuid NOT NULL REFERENCES public.fishermen(id) ON DELETE CASCADE,
  role text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (trip_id, fisherman_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trip_crew TO authenticated;
GRANT ALL ON public.trip_crew TO service_role;
ALTER TABLE public.trip_crew ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "trip_crew read auth" ON public.trip_crew;
CREATE POLICY "trip_crew read auth" ON public.trip_crew FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "trip_crew write auth" ON public.trip_crew;
CREATE POLICY "trip_crew write auth" ON public.trip_crew FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS idx_trip_crew_trip ON public.trip_crew(trip_id);

-- 7. trip_status_history
CREATE TABLE IF NOT EXISTS public.trip_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL REFERENCES public.sea_trips(id) ON DELETE CASCADE,
  status public.trip_status NOT NULL,
  notes text,
  changed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.trip_status_history TO authenticated;
GRANT ALL ON public.trip_status_history TO service_role;
ALTER TABLE public.trip_status_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "trip_status_history read auth" ON public.trip_status_history;
CREATE POLICY "trip_status_history read auth" ON public.trip_status_history FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "trip_status_history insert auth" ON public.trip_status_history;
CREATE POLICY "trip_status_history insert auth" ON public.trip_status_history FOR INSERT TO authenticated WITH CHECK (true);
CREATE INDEX IF NOT EXISTS idx_trip_history_trip ON public.trip_status_history(trip_id);

-- 8. Trigger: log every status change to history
CREATE OR REPLACE FUNCTION public.log_trip_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.trip_status_history (trip_id, status, changed_by)
    VALUES (NEW.id, NEW.status, NEW.created_by);
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.trip_status_history (trip_id, status, changed_by, notes)
    VALUES (NEW.id, NEW.status, auth.uid(), NEW.notes);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_sea_trips_log_status ON public.sea_trips;
CREATE TRIGGER trg_sea_trips_log_status
  AFTER INSERT OR UPDATE OF status ON public.sea_trips
  FOR EACH ROW EXECUTE FUNCTION public.log_trip_status_change();

-- 9. Realtime for trips
ALTER PUBLICATION supabase_realtime ADD TABLE public.sea_trips;
