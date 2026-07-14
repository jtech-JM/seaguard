create or replace function public.set_user_role(_user_id uuid, _role public.app_role, _enabled boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_role(auth.uid(), 'admin') then
    raise exception 'Only admins can change roles';
  end if;

  if _enabled then
    insert into public.user_roles (user_id, role)
    select _user_id, _role
    where not exists (
      select 1 from public.user_roles where user_id = _user_id and role = _role
    );
  else
    delete from public.user_roles where user_id = _user_id and role = _role;
  end if;
end;
$$;

grant execute on function public.set_user_role(uuid, public.app_role, boolean) to authenticated;

create or replace function public.create_fisherman_trip_request(
  p_boat_id uuid,
  p_device_id uuid,
  p_destination text,
  p_fishing_area text,
  p_expected_return timestamptz,
  p_notes text,
  p_crew_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid := auth.uid();
  v_fisherman_id uuid;
  v_bmu_id uuid;
  v_trip_id uuid;
begin
  if v_profile_id is null then
    raise exception 'Authentication required';
  end if;

  if not public.has_role(v_profile_id, 'fisherman') then
    raise exception 'Only fishermen can create trips';
  end if;

  select fisherman_id, bmu_id
    into v_fisherman_id, v_bmu_id
    from public.profiles
   where id = v_profile_id;

  if v_fisherman_id is null then
    raise exception 'Profile is not linked to a fisherman record';
  end if;

  if exists (
    select 1
      from public.sea_trips
     where captain_id = v_fisherman_id
       and status in ('pending_approval', 'checked_out', 'at_sea', 'sos', 'rescue_in_progress', 'overdue')
  ) then
    raise exception 'You already have an active trip';
  end if;

  if p_boat_id is not null and not exists (
    select 1 from public.boats where id = p_boat_id and owner_fisherman_id = v_fisherman_id
  ) then
    raise exception 'Boat does not belong to this fisherman';
  end if;

  if p_device_id is not null and not exists (
    select 1
      from public.devices d
      join public.boats b on b.id = d.boat_id
     where d.id = p_device_id
       and b.owner_fisherman_id = v_fisherman_id
  ) then
    raise exception 'Device does not belong to this fisherman';
  end if;

  insert into public.sea_trips (
    captain_id,
    boat_id,
    device_id,
    bmu_id,
    status,
    planned_departure,
    expected_return,
    destination,
    fishing_area,
    notes
  )
  values (
    v_fisherman_id,
    p_boat_id,
    p_device_id,
    v_bmu_id,
    'pending_approval',
    now(),
    p_expected_return,
    p_destination,
    p_fishing_area,
    p_notes
  )
  returning id into v_trip_id;

  if coalesce(array_length(p_crew_ids, 1), 0) > 0 then
    insert into public.trip_crew (trip_id, fisherman_id, role)
    select v_trip_id, crew_id, 'Crew'
      from unnest(p_crew_ids) as crew_id
     where crew_id is not null;
  end if;

  return v_trip_id;
end;
$$;

grant execute on function public.create_fisherman_trip_request(uuid, uuid, text, text, timestamptz, text, uuid[]) to authenticated;

create or replace function public.check_in_fisherman_trip(p_trip_id uuid)
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
    raise exception 'Only fishermen can check in trips';
  end if;

  select captain_id, status
    into v_fisherman_id, v_trip_status
    from public.sea_trips
   where id = p_trip_id;

  if v_fisherman_id is null then
    raise exception 'Trip not found';
  end if;

  if v_fisherman_id <> (
    select fisherman_id from public.profiles where id = v_profile_id
  ) then
    raise exception 'Trip does not belong to this fisherman';
  end if;

  if v_trip_status not in ('at_sea', 'overdue', 'rescued') then
    raise exception 'Trip cannot be checked in from this status';
  end if;

  update public.sea_trips
     set status = 'returned',
         actual_return = now()
   where id = p_trip_id;
end;
$$;

grant execute on function public.check_in_fisherman_trip(uuid) to authenticated;

create or replace function public.trigger_fisherman_sos(
  p_device_id uuid,
  p_lat double precision,
  p_lng double precision,
  p_accuracy double precision,
  p_notes text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid := auth.uid();
  v_fisherman_id uuid;
  v_bmu_id uuid;
  v_device_active boolean;
  v_alert_id uuid;
begin
  if v_profile_id is null then
    raise exception 'Authentication required';
  end if;

  if not public.has_role(v_profile_id, 'fisherman') then
    raise exception 'Only fishermen can trigger SOS';
  end if;

  select fisherman_id, bmu_id
    into v_fisherman_id, v_bmu_id
    from public.profiles
   where id = v_profile_id;

  if v_fisherman_id is null then
    raise exception 'Profile is not linked to a fisherman record';
  end if;

  select active
    into v_device_active
    from public.devices d
    join public.boats b on b.id = d.boat_id
   where d.id = p_device_id
     and b.owner_fisherman_id = v_fisherman_id;

  if v_device_active is null then
    raise exception 'Device does not belong to this fisherman';
  end if;

  if not v_device_active then
    raise exception 'Device is disabled';
  end if;

  insert into public.sos_alerts (
    device_id,
    boat_id,
    fisherman_id,
    bmu_id,
    status,
    last_lat,
    last_lng,
    last_accuracy,
    last_ping_at,
    notes,
    emergency_level
  )
  values (
    p_device_id,
    (select boat_id from public.devices where id = p_device_id),
    v_fisherman_id,
    v_bmu_id,
    'new',
    p_lat,
    p_lng,
    p_accuracy,
    now(),
    coalesce(p_notes, 'Triggered via software client'),
    'HIGH'
  )
  returning id into v_alert_id;

  insert into public.gps_logs (alert_id, device_id, lat, lng, accuracy)
  values (v_alert_id, p_device_id, p_lat, p_lng, p_accuracy);

  update public.sea_trips
     set status = 'sos'
   where captain_id = v_fisherman_id
     and status in ('pending_approval', 'checked_out', 'at_sea', 'sos', 'rescue_in_progress', 'overdue');

  return v_alert_id;
end;
$$;

grant execute on function public.trigger_fisherman_sos(uuid, double precision, double precision, double precision, text) to authenticated;

create or replace function public.cancel_fisherman_sos(p_alert_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid := auth.uid();
  v_fisherman_id uuid;
  v_alert_fisherman_id uuid;
begin
  if v_profile_id is null then
    raise exception 'Authentication required';
  end if;

  if not public.has_role(v_profile_id, 'fisherman') then
    raise exception 'Only fishermen can cancel SOS';
  end if;

  select fisherman_id
    into v_fisherman_id
    from public.profiles
   where id = v_profile_id;

  if v_fisherman_id is null then
    raise exception 'Profile is not linked to a fisherman record';
  end if;

  select fisherman_id
    into v_alert_fisherman_id
    from public.sos_alerts
   where id = p_alert_id;

  if v_alert_fisherman_id is distinct from v_fisherman_id then
    raise exception 'SOS alert does not belong to this fisherman';
  end if;

  update public.sos_alerts
     set status = 'closed',
         resolved_at = now(),
         notes = concat_ws(E'\n', coalesce(notes, ''), 'Cancelled by fisherman: ' || coalesce(p_reason, 'No reason provided'))
   where id = p_alert_id;

  update public.rescue_operations
     set status = 'closed',
         ended_at = now(),
         notes = concat_ws(E'\n', coalesce(notes, ''), 'Cancelled by fisherman: ' || coalesce(p_reason, 'No reason provided'))
   where alert_id = p_alert_id;

  update public.sea_trips
     set status = 'at_sea'
   where captain_id = v_fisherman_id
     and status in ('sos', 'rescue_in_progress');
end;
$$;

grant execute on function public.cancel_fisherman_sos(uuid, text) to authenticated;
