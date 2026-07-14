create or replace function public.current_fisherman_id()
returns uuid
language sql
security definer
set search_path = public
as $$
  select fisherman_id from public.profiles where id = auth.uid();
$$;

create or replace function public.trip_has_current_fisherman(p_trip_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.sea_trips st
     where st.id = p_trip_id
       and st.captain_id = public.current_fisherman_id()
  )
  or exists (
    select 1
      from public.trip_crew tc
     where tc.trip_id = p_trip_id
       and tc.fisherman_id = public.current_fisherman_id()
  );
$$;

create or replace function public.trip_captain_is_current_fisherman(p_trip_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.sea_trips st
     where st.id = p_trip_id
       and st.captain_id = public.current_fisherman_id()
  );
$$;

drop policy if exists "sea_trips read scoped" on public.sea_trips;
create policy "sea_trips read scoped" on public.sea_trips
for select to authenticated
using (
  public.trip_has_current_fisherman(id)
  or public.current_user_role() in ('admin', 'rescue_officer', 'bmu_officer')
);

drop policy if exists "sea_trips write scoped" on public.sea_trips;
create policy "sea_trips write scoped" on public.sea_trips
for update to authenticated
using (
  public.trip_captain_is_current_fisherman(id)
  or public.current_user_role() in ('admin', 'rescue_officer', 'bmu_officer')
)
with check (
  public.trip_captain_is_current_fisherman(id)
  or public.current_user_role() in ('admin', 'rescue_officer', 'bmu_officer')
);

drop policy if exists "trip_crew read scoped" on public.trip_crew;
create policy "trip_crew read scoped" on public.trip_crew
for select to authenticated
using (
  fisherman_id = public.current_fisherman_id()
  or public.trip_captain_is_current_fisherman(trip_id)
  or public.current_user_role() in ('admin', 'rescue_officer', 'bmu_officer')
);

drop policy if exists "trip_status_history read scoped" on public.trip_status_history;
create policy "trip_status_history read scoped" on public.trip_status_history
for select to authenticated
using (
  exists (
    select 1
      from public.sea_trips st
     where st.id = trip_status_history.trip_id
       and (
         public.trip_has_current_fisherman(st.id)
         or public.current_user_role() in ('admin', 'rescue_officer', 'bmu_officer')
       )
  )
);

drop policy if exists "sos_alerts read scoped" on public.sos_alerts;
create policy "sos_alerts read scoped" on public.sos_alerts
for select to authenticated
using (
  fisherman_id = public.current_fisherman_id()
  or public.current_user_role() in ('admin', 'rescue_officer', 'bmu_officer')
);

drop policy if exists "sos_alerts update scoped" on public.sos_alerts;
create policy "sos_alerts update scoped" on public.sos_alerts
for update to authenticated
using (
  fisherman_id = public.current_fisherman_id()
  or public.current_user_role() in ('admin', 'rescue_officer', 'bmu_officer')
)
with check (
  fisherman_id = public.current_fisherman_id()
  or public.current_user_role() in ('admin', 'rescue_officer', 'bmu_officer')
);

drop policy if exists "gps read scoped" on public.gps_logs;
create policy "gps read scoped" on public.gps_logs
for select to authenticated
using (
  exists (
    select 1
      from public.sos_alerts sa
     where sa.id = gps_logs.alert_id
       and (
         sa.fisherman_id = public.current_fisherman_id()
         or public.current_user_role() in ('admin', 'rescue_officer', 'bmu_officer')
       )
  )
);

drop policy if exists "gps insert scoped" on public.gps_logs;
create policy "gps insert scoped" on public.gps_logs
for insert to authenticated
with check (
  exists (
    select 1
      from public.sos_alerts sa
     where sa.id = gps_logs.alert_id
       and (
         sa.fisherman_id = public.current_fisherman_id()
         or public.current_user_role() in ('admin', 'rescue_officer', 'bmu_officer')
       )
  )
);

with ranked_links as (
  select id,
         row_number() over (
           partition by fisherman_id
           order by updated_at desc nulls last, created_at desc nulls last, id
         ) as rn
    from public.profiles
   where fisherman_id is not null
)
update public.profiles p
   set fisherman_id = null
  from ranked_links r
 where p.id = r.id
   and r.rn > 1;

create unique index if not exists profiles_one_user_per_fisherman
  on public.profiles(fisherman_id)
  where fisherman_id is not null;

create or replace function public.admin_link_profile_to_fisherman(
  p_profile_id uuid,
  p_fisherman_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_role(auth.uid(), 'admin') then
    raise exception 'Only admins can link fisherman records';
  end if;

  if p_fisherman_id is not null and exists (
    select 1
      from public.user_roles
     where user_id = p_profile_id
       and role in ('admin', 'bmu_officer', 'rescue_officer')
  ) then
    raise exception 'Staff accounts cannot be linked to fishermen';
  end if;

  update public.profiles
     set fisherman_id = null
   where p_fisherman_id is not null
     and fisherman_id = p_fisherman_id
     and id <> p_profile_id;

  update public.profiles
     set fisherman_id = p_fisherman_id
   where id = p_profile_id;

  perform public.log_audit_event(
    'profile_fisherman_link_changed',
    'profile',
    p_profile_id,
    jsonb_build_object('fisherman_id', p_fisherman_id)
  );
end;
$$;

grant execute on function public.admin_link_profile_to_fisherman(uuid, uuid) to authenticated;
