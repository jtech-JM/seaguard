-- ============================================================
-- Fix devices RLS: allow fishermen to read their own device.
--
-- The previous policy only allowed admin/bmu_officer/rescue_officer.
-- Now that devices.fisherman_id exists, a fisherman must be able
-- to read the device assigned to them so the portal can display
-- it and the software SOS trigger can validate it.
-- ============================================================

DROP POLICY IF EXISTS "devices read scoped" ON public.devices;

CREATE POLICY "devices read scoped" ON public.devices
FOR SELECT TO authenticated
USING (
  -- Staff roles can read all devices
  public.current_user_role() IN ('admin', 'bmu_officer', 'rescue_officer')
  OR
  -- A fisherman can read only the device assigned to them
  fisherman_id = public.current_fisherman_id()
);
