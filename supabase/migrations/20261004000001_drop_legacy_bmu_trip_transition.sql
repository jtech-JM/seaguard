DROP FUNCTION IF EXISTS public.bmu_transition_trip(uuid, public.trip_status);

NOTIFY pgrst, 'reload schema';
