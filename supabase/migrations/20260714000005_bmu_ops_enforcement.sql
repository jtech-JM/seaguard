create or replace function public.manage_bmu_fisherman(
  p_action text,
  p_id uuid default null,
  p_full_name text default null,
  p_phone text default null,
  p_national_id text default null,
  p_emergency_contact_name text default null,
  p_emergency_contact_phone text default null,
  p_photo_url text default null,
  p_active boolean default true,
  p_bmu_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid := auth.uid();
  v_fisherman_id uuid;
begin
  if v_profile_id is null then
    raise exception 'Authentication required';
  end if;

  if not public.has_role(v_profile_id, 'bmu_officer') then
    raise exception 'Only BMU officers can manage fishermen';
  end if;

  if p_action = 'create' then
    insert into public.fishermen (
      full_name,
      phone,
      national_id,
      emergency_contact_name,
      emergency_contact_phone,
      photo_url,
      active,
      bmu_id
    )
    values (
      coalesce(p_full_name, ''),
      p_phone,
      p_national_id,
      p_emergency_contact_name,
      p_emergency_contact_phone,
      p_photo_url,
      coalesce(p_active, true),
      p_bmu_id
    )
    returning id into v_fisherman_id;
    return v_fisherman_id;
  elsif p_action = 'update' then
    if p_id is null then
      raise exception 'Missing fisherman id';
    end if;

    update public.fishermen
       set full_name = coalesce(p_full_name, full_name),
           phone = p_phone,
           national_id = p_national_id,
           emergency_contact_name = p_emergency_contact_name,
           emergency_contact_phone = p_emergency_contact_phone,
           photo_url = p_photo_url,
           active = coalesce(p_active, active),
           bmu_id = p_bmu_id
     where id = p_id;
    return p_id;
  elsif p_action = 'delete' then
    if p_id is null then
      raise exception 'Missing fisherman id';
    end if;

    delete from public.fishermen where id = p_id;
    return p_id;
  else
    raise exception 'Unsupported fisherman action';
  end if;
end;
$$;

grant execute on function public.manage_bmu_fisherman(text, uuid, text, text, text, text, text, text, boolean, uuid) to authenticated;

create or replace function public.link_profile_to_fisherman(p_profile_id uuid, p_fisherman_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid := auth.uid();
begin
  if v_profile_id is null then
    raise exception 'Authentication required';
  end if;

  if not public.has_role(v_profile_id, 'bmu_officer') then
    raise exception 'Only BMU officers can link profiles';
  end if;

  if exists (select 1 from public.user_roles where user_id = p_profile_id and role in ('admin', 'bmu_officer', 'rescue_officer')) then
    raise exception 'Staff accounts cannot be linked to fishermen';
  end if;

  update public.profiles
     set fisherman_id = p_fisherman_id
   where id = p_profile_id;
end;
$$;

grant execute on function public.link_profile_to_fisherman(uuid, uuid) to authenticated;

create or replace function public.unlink_profile_from_fisherman(p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid := auth.uid();
begin
  if v_profile_id is null then
    raise exception 'Authentication required';
  end if;

  if not public.has_role(v_profile_id, 'bmu_officer') then
    raise exception 'Only BMU officers can unlink profiles';
  end if;

  update public.profiles
     set fisherman_id = null
   where id = p_profile_id;
end;
$$;

grant execute on function public.unlink_profile_from_fisherman(uuid) to authenticated;

create or replace function public.manage_bmu_boat(
  p_action text,
  p_id uuid default null,
  p_name text default null,
  p_registration_number text default null,
  p_boat_type text default null,
  p_owner_fisherman_id uuid default null,
  p_bmu_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid := auth.uid();
  v_boat_id uuid;
begin
  if v_profile_id is null then
    raise exception 'Authentication required';
  end if;

  if not public.has_role(v_profile_id, 'bmu_officer') then
    raise exception 'Only BMU officers can manage boats';
  end if;

  if p_action = 'create' then
    insert into public.boats (name, registration_number, boat_type, owner_fisherman_id, bmu_id)
    values (coalesce(p_name, ''), p_registration_number, p_boat_type, p_owner_fisherman_id, p_bmu_id)
    returning id into v_boat_id;
    return v_boat_id;
  elsif p_action = 'update' then
    if p_id is null then
      raise exception 'Missing boat id';
    end if;

    update public.boats
       set name = coalesce(p_name, name),
           registration_number = p_registration_number,
           boat_type = p_boat_type,
           owner_fisherman_id = p_owner_fisherman_id,
           bmu_id = p_bmu_id
     where id = p_id;
    return p_id;
  elsif p_action = 'delete' then
    if p_id is null then
      raise exception 'Missing boat id';
    end if;

    delete from public.boats where id = p_id;
    return p_id;
  else
    raise exception 'Unsupported boat action';
  end if;
end;
$$;

grant execute on function public.manage_bmu_boat(text, uuid, text, text, text, uuid, uuid) to authenticated;

create or replace function public.manage_bmu_device(
  p_action text,
  p_id uuid default null,
  p_device_id text default null,
  p_boat_id uuid default null,
  p_hardware_type text default null,
  p_active boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid := auth.uid();
  v_device_id uuid;
  v_secret text;
begin
  if v_profile_id is null then
    raise exception 'Authentication required';
  end if;

  if not public.has_role(v_profile_id, 'bmu_officer') then
    raise exception 'Only BMU officers can manage devices';
  end if;

  if p_action = 'create' then
    v_secret := md5(random()::text || clock_timestamp()::text);
    insert into public.devices (device_id, boat_id, hardware_type, active, device_secret)
    values (p_device_id, p_boat_id, p_hardware_type, coalesce(p_active, true), v_secret)
    returning id into v_device_id;
    return jsonb_build_object('id', v_device_id, 'device_secret', v_secret);
  elsif p_action = 'update' then
    if p_id is null then
      raise exception 'Missing device id';
    end if;

    update public.devices
       set device_id = coalesce(p_device_id, device_id),
           boat_id = p_boat_id,
           hardware_type = p_hardware_type,
           active = coalesce(p_active, active)
     where id = p_id;
    return jsonb_build_object('id', p_id, 'device_secret', null);
  elsif p_action = 'delete' then
    if p_id is null then
      raise exception 'Missing device id';
    end if;

    delete from public.devices where id = p_id;
    return jsonb_build_object('id', p_id, 'device_secret', null);
  else
    raise exception 'Unsupported device action';
  end if;
end;
$$;

grant execute on function public.manage_bmu_device(text, uuid, text, uuid, text, boolean) to authenticated;

create or replace function public.manage_trip_crew_member(
  p_action text,
  p_trip_id uuid,
  p_fisherman_id uuid default null,
  p_role text default null,
  p_crew_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid := auth.uid();
begin
  if v_profile_id is null then
    raise exception 'Authentication required';
  end if;

  if not public.has_role(v_profile_id, 'bmu_officer') then
    raise exception 'Only BMU officers can manage crew';
  end if;

  if p_action = 'add' then
    insert into public.trip_crew (trip_id, fisherman_id, role)
    values (p_trip_id, p_fisherman_id, p_role);
  elsif p_action = 'remove' then
    delete from public.trip_crew where id = p_crew_id;
  else
    raise exception 'Unsupported crew action';
  end if;
end;
$$;

grant execute on function public.manage_trip_crew_member(text, uuid, uuid, text, uuid) to authenticated;

create or replace function public.bmu_transition_trip(p_trip_id uuid, p_target_status public.trip_status)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid := auth.uid();
  v_current_status public.trip_status;
begin
  if v_profile_id is null then
    raise exception 'Authentication required';
  end if;

  if not public.has_role(v_profile_id, 'bmu_officer') then
    raise exception 'Only BMU officers can change trip status';
  end if;

  select status into v_current_status from public.sea_trips where id = p_trip_id;
  if v_current_status is null then
    raise exception 'Trip not found';
  end if;

  if (v_current_status = 'pending_approval' and p_target_status not in ('at_sea', 'cancelled'))
     or (v_current_status = 'at_sea' and p_target_status <> 'overdue')
     or (v_current_status = 'overdue' and p_target_status <> 'overdue') then
    raise exception 'Invalid trip transition';
  end if;

  update public.sea_trips
     set status = p_target_status,
         actual_departure = case when p_target_status = 'at_sea' and actual_departure is null then now() else actual_departure end,
         actual_return = case when p_target_status = 'returned' and actual_return is null then now() else actual_return end
   where id = p_trip_id;
end;
$$;

grant execute on function public.bmu_transition_trip(uuid, public.trip_status) to authenticated;
