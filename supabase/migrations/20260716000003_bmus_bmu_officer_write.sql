-- The insert and update policies on bmus were restricted to admin only,
-- but BMU creation and editing is done from the BMU officer dashboard.
-- Expand INSERT, UPDATE, and DELETE to include bmu_officer, consistent
-- with how fishermen, boats, and devices are scoped.

-- UPDATE — was admin only
DROP POLICY IF EXISTS "bmus write scoped" ON public.bmus;
CREATE POLICY "bmus write scoped" ON public.bmus
FOR UPDATE TO authenticated
USING (public.current_user_role() IN ('admin', 'bmu_officer'))
WITH CHECK (public.current_user_role() IN ('admin', 'bmu_officer'));

-- INSERT — was admin only
DROP POLICY IF EXISTS "bmus insert scoped" ON public.bmus;
CREATE POLICY "bmus insert scoped" ON public.bmus
FOR INSERT TO authenticated
WITH CHECK (public.current_user_role() IN ('admin', 'bmu_officer'));

-- DELETE — was admin only
DROP POLICY IF EXISTS "bmus delete scoped" ON public.bmus;
CREATE POLICY "bmus delete scoped" ON public.bmus
FOR DELETE TO authenticated
USING (public.current_user_role() IN ('admin', 'bmu_officer'));
