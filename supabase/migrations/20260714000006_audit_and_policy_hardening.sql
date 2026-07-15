create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.audit_logs enable row level security;

drop policy if exists "audit_logs read admin" on public.audit_logs;

create policy "audit_logs read admin"
  on public.audit_logs
  for select
  to authenticated
  using (public.has_role(auth.uid(), 'admin'));

create or replace function public.log_audit_event(
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_details jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, details)
  values (auth.uid(), p_action, p_entity_type, p_entity_id, coalesce(p_details, '{}'::jsonb));
end;
$$;

grant execute on function public.log_audit_event(text, text, uuid, jsonb) to authenticated;

create or replace function public.set_user_role(_user_id uuid, _role public.app_role, _enabled boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_last_admin boolean;
begin
  if not public.has_role(auth.uid(), 'admin') then
    raise exception 'Only admins can change roles';
  end if;

  if _role = 'admin' and not _enabled then
    select not exists (
      select 1
        from public.user_roles
       where user_id <> _user_id
         and role = 'admin'
    ) into v_is_last_admin;

    if v_is_last_admin then
      raise exception 'Cannot remove the last admin role';
    end if;
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

  perform public.log_audit_event(
    case when _enabled then 'role_enabled' else 'role_disabled' end,
    'user_role',
    _user_id,
    jsonb_build_object('role', _role, 'enabled', _enabled)
  );
end;
$$;

grant execute on function public.set_user_role(uuid, public.app_role, boolean) to authenticated;

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

  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required for cancelling an SOS';
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

  perform public.log_audit_event(
    'sos_cancelled',
    'sos_alert',
    p_alert_id,
    jsonb_build_object('reason', p_reason)
  );
end;
$$;

grant execute on function public.cancel_fisherman_sos(uuid, text) to authenticated;

create or replace function public.assign_rescue_operation(p_alert_id uuid, p_team_name text, p_notes text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid := auth.uid();
  v_alert_status public.alert_status;
begin
  if v_profile_id is null then
    raise exception 'Authentication required';
  end if;

  if not public.has_role(v_profile_id, 'rescue_officer') then
    raise exception 'Only rescue officers can assign rescue operations';
  end if;

  select status into v_alert_status from public.sos_alerts where id = p_alert_id;
  if v_alert_status is null then
    raise exception 'Alert not found';
  end if;

  if v_alert_status not in ('new', 'acknowledged', 'assigned', 'in_progress') then
    raise exception 'Alert is not in an assignable state';
  end if;

  insert into public.rescue_operations (alert_id, team_name, notes, status, started_at, assigned_by)
  values (p_alert_id, p_team_name, p_notes, 'assigned', now(), v_profile_id);

  update public.sos_alerts
     set status = 'assigned',
         acknowledged_at = coalesce(acknowledged_at, now())
   where id = p_alert_id;

  perform public.log_audit_event(
    'rescue_assigned',
    'sos_alert',
    p_alert_id,
    jsonb_build_object('team_name', p_team_name, 'notes', p_notes)
  );
end;
$$;

grant execute on function public.assign_rescue_operation(uuid, text, text) to authenticated;

create or replace function public.close_rescue_operation(p_alert_id uuid, p_op_id uuid, p_notes text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid := auth.uid();
  v_alert_status public.alert_status;
begin
  if v_profile_id is null then
    raise exception 'Authentication required';
  end if;

  if not public.has_role(v_profile_id, 'rescue_officer') then
    raise exception 'Only rescue officers can close rescue operations';
  end if;

  if coalesce(trim(p_notes), '') = '' then
    raise exception 'A closure note is required';
  end if;

  select status into v_alert_status from public.sos_alerts where id = p_alert_id;
  if v_alert_status is null then
    raise exception 'Alert not found';
  end if;

  if v_alert_status not in ('assigned', 'in_progress', 'resolved') then
    raise exception 'Alert is not in a closeable state';
  end if;

  update public.rescue_operations
     set status = 'resolved',
         ended_at = now(),
         notes = coalesce(p_notes, notes)
   where id = p_op_id and alert_id = p_alert_id;

  update public.sos_alerts
     set status = 'resolved',
         resolved_at = now()
   where id = p_alert_id;

  update public.sea_trips
     set status = 'at_sea'
   where captain_id in (select fisherman_id from public.sos_alerts where id = p_alert_id)
     and status in ('sos', 'rescue_in_progress');

  perform public.log_audit_event(
    'rescue_closed',
    'sos_alert',
    p_alert_id,
    jsonb_build_object('operation_id', p_op_id, 'notes', p_notes)
  );
end;
$$;

grant execute on function public.close_rescue_operation(uuid, uuid, text) to authenticated;

create or replace function public.update_alert_status(p_alert_id uuid, p_next_status public.alert_status, p_notes text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid := auth.uid();
  v_current_status public.alert_status;
begin
  if v_profile_id is null then
    raise exception 'Authentication required';
  end if;

  if not public.has_role(v_profile_id, 'rescue_officer') then
    raise exception 'Only rescue officers can change alert status';
  end if;

  select status into v_current_status from public.sos_alerts where id = p_alert_id;
  if v_current_status is null then
    raise exception 'Alert not found';
  end if;

  if (v_current_status = 'new' and p_next_status not in ('acknowledged', 'assigned', 'closed'))
     or (v_current_status = 'acknowledged' and p_next_status not in ('assigned', 'in_progress', 'closed'))
     or (v_current_status = 'assigned' and p_next_status not in ('in_progress', 'resolved', 'closed'))
     or (v_current_status = 'in_progress' and p_next_status not in ('resolved', 'closed'))
     or (v_current_status = 'resolved' and p_next_status not in ('closed'))
     or (v_current_status = 'closed' and p_next_status not in ('closed')) then
    raise exception 'Invalid alert transition';
  end if;

  update public.sos_alerts
     set status = p_next_status,
         acknowledged_at = case when p_next_status in ('acknowledged', 'assigned', 'in_progress', 'resolved', 'closed') and acknowledged_at is null then now() else acknowledged_at end,
         resolved_at = case when p_next_status in ('resolved', 'closed') and resolved_at is null then now() else resolved_at end,
         notes = concat_ws(E'\n', coalesce(notes, ''), coalesce(p_notes, ''))
   where id = p_alert_id;

  perform public.log_audit_event(
    'alert_status_changed',
    'sos_alert',
    p_alert_id,
    jsonb_build_object('from_status', v_current_status, 'to_status', p_next_status, 'notes', p_notes)
  );
end;
$$;

grant execute on function public.update_alert_status(uuid, public.alert_status, text) to authenticated;

create or replace function public.bmu_transition_trip(p_trip_id uuid, p_target_status public.trip_status, p_reason text)
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

  if p_target_status = 'cancelled' and coalesce(trim(p_reason), '') = '' then
    raise exception 'A cancellation reason is required';
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

  perform public.log_audit_event(
    'trip_status_changed',
    'sea_trip',
    p_trip_id,
    jsonb_build_object('from_status', v_current_status, 'to_status', p_target_status, 'reason', p_reason)
  );
end;
$$;

grant execute on function public.bmu_transition_trip(uuid, public.trip_status, text) to authenticated;

create or replace function public.manage_bmu_device(
  p_action text,
  p_id uuid default null,
  p_device_id text default null,
  p_boat_id uuid default null,
  p_hardware_type text default null,
  p_active boolean default true,
  p_reason text default null
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

    if not coalesce(p_active, true) and coalesce(trim(p_reason), '') = '' then
      raise exception 'A reason is required when disabling a device';
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

grant execute on function public.manage_bmu_device(text, uuid, text, uuid, text, boolean, text) to authenticated;
