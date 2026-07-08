-- ============================================================
-- Allow authenticated users to read all profiles and update
-- fisherman_id on any profile (needed for BMU officer linking).
-- The previous policies only allowed users to read/update their
-- own row, which blocked the BMU officer from searching accounts
-- and setting profiles.fisherman_id on other users.
-- ============================================================

-- 1. Drop the restrictive read policy and replace with full read
DROP POLICY IF EXISTS "profiles read own" ON public.profiles;
CREATE POLICY "profiles read auth"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (true);

-- 2. Drop the restrictive update policy and replace with full update
--    for authenticated users (BMU officers need to set fisherman_id)
DROP POLICY IF EXISTS "profiles update own" ON public.profiles;
CREATE POLICY "profiles update auth"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);
