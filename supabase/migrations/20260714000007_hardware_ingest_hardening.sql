create table if not exists public.ingest_request_logs (
  id uuid primary key default gen_random_uuid(),
  device_id text,
  source_ip text,
  endpoint text not null,
  nonce text,
  status_code int not null,
  error_message text,
  created_at timestamptz not null default now()
);

alter table public.ingest_request_logs enable row level security;

drop policy if exists "ingest_request_logs read admin" on public.ingest_request_logs;

create policy "ingest_request_logs read admin"
  on public.ingest_request_logs
  for select
  to authenticated
  using (public.has_role(auth.uid(), 'admin'));

create or replace function public.log_ingest_request(
  p_device_id text,
  p_source_ip text,
  p_endpoint text,
  p_nonce text,
  p_status_code int,
  p_error_message text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.ingest_request_logs (
    device_id,
    source_ip,
    endpoint,
    nonce,
    status_code,
    error_message
  ) values (
    p_device_id,
    p_source_ip,
    p_endpoint,
    p_nonce,
    p_status_code,
    p_error_message
  );
end;
$$;

grant execute on function public.log_ingest_request(text, text, text, text, int, text) to authenticated;
