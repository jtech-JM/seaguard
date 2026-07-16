-- ============================================================
-- Remove stale enum values: rescue_team, rescue_coordinator
--
-- Both values were data-migrated to rescue_officer in
-- 20260706000001_four_roles_data.sql and have had no live rows
-- since. Postgres cannot DROP an enum value directly, so we:
--   1. Verify no live rows reference the stale values (safety guard)
--   2. Drop the two functions whose signatures reference app_role
--   3. Convert the column to text temporarily
--   4. Drop and recreate app_role with only the 4 valid values
--   5. Convert the column back
--   6. Recreate has_role and set_user_role with the clean enum
-- ============================================================

-- 1. Safety guard — abort if any stale values still exist in data
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE role::text IN ('rescue_team', 'rescue_coordinator')
  ) THEN
    RAISE EXCEPTION
      'Cannot clean enum: rows with rescue_team or rescue_coordinator still exist in user_roles. Run the data migration first.';
  END IF;
END;
$$;

-- 2. Drop functions whose signatures are typed to app_role.
--    CASCADE drops the two RLS policies that depend on has_role;
--    we recreate them in step 7 below.
DROP FUNCTION IF EXISTS public.has_role(uuid, public.app_role) CASCADE;
DROP FUNCTION IF EXISTS public.set_user_role(uuid, public.app_role, boolean) CASCADE;

-- 3. Convert the column to text so the old enum type is no longer depended on
ALTER TABLE public.user_roles
  ALTER COLUMN role TYPE text;

-- 4. Drop and recreate the enum with only the 4 required values
DROP TYPE public.app_role;

CREATE TYPE public.app_role AS ENUM (
  'admin',
  'bmu_officer',
  'rescue_officer',
  'fisherman'
);

-- 5. Cast the column back to the clean enum type
ALTER TABLE public.user_roles
  ALTER COLUMN role TYPE public.app_role
  USING role::public.app_role;

-- 6a. Recreate has_role (used in RLS policies and all enforcement functions)
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- 6b. Recreate set_user_role (latest version — includes last-admin guard + audit log)
CREATE OR REPLACE FUNCTION public.set_user_role(_user_id uuid, _role public.app_role, _enabled boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_last_admin boolean;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can change roles';
  END IF;

  IF _role = 'admin' AND NOT _enabled THEN
    SELECT NOT EXISTS (
      SELECT 1
        FROM public.user_roles
       WHERE user_id <> _user_id
         AND role = 'admin'
    ) INTO v_is_last_admin;

    IF v_is_last_admin THEN
      RAISE EXCEPTION 'Cannot remove the last admin role';
    END IF;
  END IF;

  IF _enabled THEN
    INSERT INTO public.user_roles (user_id, role)
    SELECT _user_id, _role
    WHERE NOT EXISTS (
      SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role
    );
  ELSE
    DELETE FROM public.user_roles WHERE user_id = _user_id AND role = _role;
  END IF;

  PERFORM public.log_audit_event(
    CASE WHEN _enabled THEN 'role_enabled' ELSE 'role_disabled' END,
    'user_role',
    _user_id,
    jsonb_build_object('role', _role, 'enabled', _enabled)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_user_role(uuid, public.app_role, boolean) TO authenticated;

-- 7. Recreate the two RLS policies that were dropped via CASCADE in step 2

DROP POLICY IF EXISTS "audit_logs read admin" ON public.audit_logs;
CREATE POLICY "audit_logs read admin"
  ON public.audit_logs
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "ingest_request_logs read admin" ON public.ingest_request_logs;
CREATE POLICY "ingest_request_logs read admin"
  ON public.ingest_request_logs
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
