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
end;
$$;

grant execute on function public.update_alert_status(uuid, public.alert_status, text) to authenticated;
