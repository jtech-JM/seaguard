create or replace function public.cancel_fisherman_trip_request(p_trip_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid := auth.uid();
  v_fisherman_id uuid;
  v_trip_status public.trip_status;
begin
  if v_profile_id is null then
    raise exception 'Authentication required';
  end if;

  if not public.has_role(v_profile_id, 'fisherman') then
    raise exception 'Only fishermen can cancel trip requests';
  end if;

  select fisherman_id
    into v_fisherman_id
    from public.profiles
   where id = v_profile_id;

  if v_fisherman_id is null then
    raise exception 'Profile is not linked to a fisherman record';
  end if;

  select status
    into v_trip_status
    from public.sea_trips
   where id = p_trip_id;

  if v_trip_status is null then
    raise exception 'Trip not found';
  end if;

  if v_trip_status <> 'pending_approval' then
    raise exception 'Only pending trip requests can be cancelled';
  end if;

  if not exists (
    select 1
      from public.sea_trips
     where id = p_trip_id
       and captain_id = v_fisherman_id
  ) then
    raise exception 'Trip does not belong to this fisherman';
  end if;

  update public.sea_trips
     set status = 'cancelled'
   where id = p_trip_id;
end;
$$;

grant execute on function public.cancel_fisherman_trip_request(uuid) to authenticated;
