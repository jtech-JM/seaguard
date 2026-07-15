DROP POLICY IF EXISTS "profiles read own" ON public.profiles;
DROP POLICY IF EXISTS "profiles update own" ON public.profiles;
DROP POLICY IF EXISTS "profiles insert own" ON public.profiles;
DROP POLICY IF EXISTS "profiles read auth" ON public.profiles;
DROP POLICY IF EXISTS "profiles update auth" ON public.profiles;

CREATE POLICY "profiles read scoped" ON public.profiles
FOR SELECT TO authenticated
USING (
  auth.uid() = id
  OR public.current_user_role() IN ('admin', 'bmu_officer', 'rescue_officer')
);

CREATE POLICY "profiles update scoped" ON public.profiles
FOR UPDATE TO authenticated
USING (
  auth.uid() = id
  OR public.current_user_role() = 'admin'
)
WITH CHECK (
  auth.uid() = id
  OR public.current_user_role() = 'admin'
);

CREATE POLICY "profiles insert scoped" ON public.profiles
FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() = id
  OR public.current_user_role() = 'admin'
);

DROP POLICY IF EXISTS "user_roles read own" ON public.user_roles;
DROP POLICY IF EXISTS "user_roles read auth" ON public.user_roles;

CREATE POLICY "user_roles read scoped" ON public.user_roles
FOR SELECT TO authenticated
USING (
  auth.uid() = user_id
  OR public.current_user_role() = 'admin'
);

CREATE POLICY "user_roles write scoped" ON public.user_roles
FOR INSERT TO authenticated
WITH CHECK (public.current_user_role() = 'admin');

DROP POLICY IF EXISTS "bmus all auth" ON public.bmus;
DROP POLICY IF EXISTS "bmus read auth" ON public.bmus;

CREATE POLICY "bmus read scoped" ON public.bmus
FOR SELECT TO authenticated
USING (public.current_user_role() IN ('admin', 'bmu_officer', 'rescue_officer'));

CREATE POLICY "bmus write scoped" ON public.bmus
FOR UPDATE TO authenticated
USING (public.current_user_role() = 'admin')
WITH CHECK (public.current_user_role() = 'admin');

DROP POLICY IF EXISTS "fishermen all auth" ON public.fishermen;
DROP POLICY IF EXISTS "fishermen read auth" ON public.fishermen;

CREATE POLICY "fishermen read scoped" ON public.fishermen
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.fisherman_id = fishermen.id
  )
  OR public.current_user_role() IN ('admin', 'bmu_officer', 'rescue_officer')
);

CREATE POLICY "fishermen write scoped" ON public.fishermen
FOR UPDATE TO authenticated
USING (public.current_user_role() IN ('admin', 'bmu_officer'))
WITH CHECK (public.current_user_role() IN ('admin', 'bmu_officer'));

DROP POLICY IF EXISTS "boats all auth" ON public.boats;
DROP POLICY IF EXISTS "boats read auth" ON public.boats;

CREATE POLICY "boats read scoped" ON public.boats
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.fisherman_id = boats.owner_fisherman_id
  )
  OR public.current_user_role() IN ('admin', 'bmu_officer', 'rescue_officer')
);

CREATE POLICY "boats write scoped" ON public.boats
FOR UPDATE TO authenticated
USING (public.current_user_role() IN ('admin', 'bmu_officer'))
WITH CHECK (public.current_user_role() IN ('admin', 'bmu_officer'));

DROP POLICY IF EXISTS "devices all auth" ON public.devices;
DROP POLICY IF EXISTS "devices public read" ON public.devices;
DROP POLICY IF EXISTS "devices read scoped" ON public.devices;
DROP POLICY IF EXISTS "devices write scoped" ON public.devices;

CREATE POLICY "devices read scoped" ON public.devices
FOR SELECT TO authenticated
USING (public.current_user_role() IN ('admin', 'bmu_officer', 'rescue_officer'));

CREATE POLICY "devices write scoped" ON public.devices
FOR UPDATE TO authenticated
USING (public.current_user_role() IN ('admin', 'bmu_officer'))
WITH CHECK (public.current_user_role() IN ('admin', 'bmu_officer'));

DROP POLICY IF EXISTS "gps read auth" ON public.gps_logs;
DROP POLICY IF EXISTS "gps insert auth" ON public.gps_logs;

CREATE POLICY "gps read scoped" ON public.gps_logs
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.sos_alerts sa
    WHERE sa.id = gps_logs.alert_id
      AND (
        sa.fisherman_id = auth.uid()
        OR public.current_user_role() IN ('admin', 'rescue_officer', 'bmu_officer')
      )
  )
);

CREATE POLICY "gps insert scoped" ON public.gps_logs
FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.sos_alerts sa
    WHERE sa.id = gps_logs.alert_id
      AND (
        sa.fisherman_id = auth.uid()
        OR public.current_user_role() IN ('admin', 'rescue_officer', 'bmu_officer')
      )
  )
);

DROP POLICY IF EXISTS "notif all auth" ON public.notifications;

CREATE POLICY "notifications read scoped" ON public.notifications
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.sos_alerts sa
    JOIN public.profiles p ON p.fisherman_id = sa.fisherman_id
    WHERE sa.id = notifications.alert_id
      AND p.id = auth.uid()
  )
  OR public.current_user_role() IN ('admin', 'rescue_officer', 'bmu_officer')
);

CREATE POLICY "notifications write scoped" ON public.notifications
FOR INSERT TO authenticated
WITH CHECK (public.current_user_role() IN ('admin', 'rescue_officer', 'bmu_officer'));
