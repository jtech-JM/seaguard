-- Migration 20260714000002 dropped "bmus all auth" and replaced it with
-- only a SELECT and an UPDATE policy — leaving INSERT and DELETE with no
-- matching policy (blocked by RLS).
--
-- Add the missing INSERT and DELETE policies, scoped to admin only,
-- consistent with the existing UPDATE restriction.

CREATE POLICY "bmus insert scoped" ON public.bmus
FOR INSERT TO authenticated
WITH CHECK (public.current_user_role() = 'admin');

CREATE POLICY "bmus delete scoped" ON public.bmus
FOR DELETE TO authenticated
USING (public.current_user_role() = 'admin');
