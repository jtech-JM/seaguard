CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.user_roles WHERE user_id = auth.uid() ORDER BY role LIMIT 1;
$$;

DROP POLICY IF EXISTS "sea_trips read auth" ON public.sea_trips;
CREATE POLICY "sea_trips read scoped" ON public.sea_trips
FOR SELECT TO authenticated
USING (
  auth.uid() = captain_id
  OR public.current_user_role() IN ('admin', 'rescue_officer', 'bmu_officer')
);

DROP POLICY IF EXISTS "sea_trips write scoped" ON public.sea_trips;
CREATE POLICY "sea_trips write scoped" ON public.sea_trips
FOR UPDATE TO authenticated
USING (
  auth.uid() = captain_id
  OR public.current_user_role() IN ('admin', 'rescue_officer', 'bmu_officer')
)
WITH CHECK (
  auth.uid() = captain_id
  OR public.current_user_role() IN ('admin', 'rescue_officer', 'bmu_officer')
);

DROP POLICY IF EXISTS "trip_crew read scoped" ON public.trip_crew;
CREATE POLICY "trip_crew read scoped" ON public.trip_crew
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.sea_trips st
    WHERE st.id = trip_crew.trip_id
      AND (st.captain_id = auth.uid() OR public.current_user_role() IN ('admin', 'rescue_officer', 'bmu_officer'))
  )
);

DROP POLICY IF EXISTS "trip_crew write scoped" ON public.trip_crew;
CREATE POLICY "trip_crew write scoped" ON public.trip_crew
FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.sea_trips st
    WHERE st.id = trip_crew.trip_id
      AND (st.captain_id = auth.uid() OR public.current_user_role() IN ('admin', 'bmu_officer'))
  )
);

DROP POLICY IF EXISTS "trip_status_history read scoped" ON public.trip_status_history;
CREATE POLICY "trip_status_history read scoped" ON public.trip_status_history
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.sea_trips st
    WHERE st.id = trip_status_history.trip_id
      AND (st.captain_id = auth.uid() OR public.current_user_role() IN ('admin', 'rescue_officer', 'bmu_officer'))
  )
);

DROP POLICY IF EXISTS "sos_alerts read scoped" ON public.sos_alerts;
CREATE POLICY "sos_alerts read scoped" ON public.sos_alerts
FOR SELECT TO authenticated
USING (
  auth.uid() = fisherman_id
  OR public.current_user_role() IN ('admin', 'rescue_officer', 'bmu_officer')
);

DROP POLICY IF EXISTS "sos_alerts update scoped" ON public.sos_alerts;
CREATE POLICY "sos_alerts update scoped" ON public.sos_alerts
FOR UPDATE TO authenticated
USING (
  auth.uid() = fisherman_id
  OR public.current_user_role() IN ('admin', 'rescue_officer', 'bmu_officer')
)
WITH CHECK (
  auth.uid() = fisherman_id
  OR public.current_user_role() IN ('admin', 'rescue_officer', 'bmu_officer')
);

DROP POLICY IF EXISTS "rescue_operations read scoped" ON public.rescue_operations;
CREATE POLICY "rescue_operations read scoped" ON public.rescue_operations
FOR SELECT TO authenticated
USING (public.current_user_role() IN ('admin', 'rescue_officer', 'bmu_officer'));

DROP POLICY IF EXISTS "rescue_operations write scoped" ON public.rescue_operations;
CREATE POLICY "rescue_operations write scoped" ON public.rescue_operations
FOR INSERT TO authenticated
WITH CHECK (public.current_user_role() IN ('admin', 'rescue_officer', 'bmu_officer'));

DROP POLICY IF EXISTS "devices read scoped" ON public.devices;
CREATE POLICY "devices read scoped" ON public.devices
FOR SELECT TO authenticated
USING (public.current_user_role() IN ('admin', 'bmu_officer', 'rescue_officer'));

DROP POLICY IF EXISTS "devices write scoped" ON public.devices;
CREATE POLICY "devices write scoped" ON public.devices
FOR UPDATE TO authenticated
USING (public.current_user_role() IN ('admin', 'bmu_officer'))
WITH CHECK (public.current_user_role() IN ('admin', 'bmu_officer'));
