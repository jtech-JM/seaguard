DROP POLICY IF EXISTS "bmus read assigned fisherman" ON public.bmus;
CREATE POLICY "bmus read assigned fisherman" ON public.bmus
FOR SELECT TO authenticated
USING (
  public.current_user_role() = 'fisherman'
  AND EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.fishermen f ON f.id = p.fisherman_id
    WHERE p.id = auth.uid()
      AND f.bmu_id = bmus.id
  )
);

CREATE OR REPLACE FUNCTION public.get_fisherman_crew_candidates()
RETURNS TABLE (id uuid, full_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT candidate.id, candidate.full_name
  FROM public.profiles p
  JOIN public.fishermen captain ON captain.id = p.fisherman_id
  JOIN public.fishermen candidate
    ON candidate.bmu_id = captain.bmu_id
   AND candidate.id <> captain.id
   AND candidate.active
  WHERE p.id = auth.uid()
    AND public.current_user_role() = 'fisherman'
    AND captain.active
    AND captain.bmu_id IS NOT NULL
  ORDER BY candidate.full_name;
$$;

REVOKE ALL ON FUNCTION public.get_fisherman_crew_candidates() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_fisherman_crew_candidates() TO authenticated;
