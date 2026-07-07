-- ============================================================
-- Part 2 of 2: migrate data and add constraints
-- Runs after rescue_officer is committed to the enum.
-- ============================================================

-- 1. Migrate any existing rescue_coordinator / rescue_team rows
UPDATE public.user_roles
SET    role = 'rescue_officer'
WHERE  role IN ('rescue_coordinator', 'rescue_team');

-- 2. Update handle_new_user — new signups default to fisherman
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    NEW.email
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'fisherman')
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

-- 3. Helper: returns true when a profile has no staff role
--    Used by the CHECK constraint below.
CREATE OR REPLACE FUNCTION public.profile_is_fisherman_only(_profile_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NOT EXISTS (
    SELECT 1
    FROM   public.user_roles
    WHERE  user_id = _profile_id
      AND  role    IN ('admin', 'bmu_officer', 'rescue_officer')
  );
$$;

-- 4. Clear any invalid links: staff accounts that were previously
--    assigned a fisherman_id (violates the constraint we're about to add)
UPDATE public.profiles
SET    fisherman_id = NULL
WHERE  fisherman_id IS NOT NULL
  AND  NOT public.profile_is_fisherman_only(id);

-- 5. Constraint: profiles.fisherman_id may only be set on fisherman-role accounts
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS chk_fisherman_link_staff;

ALTER TABLE public.profiles
  ADD CONSTRAINT chk_fisherman_link_staff
  CHECK (
    fisherman_id IS NULL
    OR public.profile_is_fisherman_only(id)
  );
