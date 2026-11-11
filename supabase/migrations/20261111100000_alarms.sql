-- Real ringing alarms. A reminder VIC calls an "alarm" is flagged; an iPhone
-- Shortcut automation (runs when he leaves the Claude app, and each morning)
-- fetches the alarms of the next 24 h from functions/v1/shortcut?alarms and
-- creates them in the Clock app, which rings even on silent. Each alarm is
-- handed out once (alarm_synced_at). Its own key: it can only read alarm
-- times, so it is fine inside a URL.
alter table public.items
  add column if not exists alarm boolean not null default false,
  add column if not exists alarm_synced_at timestamptz;
create index if not exists items_alarm_pending on public.items (remind_at) where alarm and alarm_synced_at is null and status = 'open';

insert into public.app_secrets (key, value)
values ('ALARM_KEY', encode(extensions.gen_random_bytes(24), 'hex'))
on conflict (key) do nothing;

create or replace function public.owner_settings() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_owner() then raise exception 'NOT_OWNER'; end if;
  return jsonb_build_object(
    'mcp_url', (select value from public.app_secrets where key = 'PROJECT_URL')
               || '/functions/v1/mcp/' || (select value from public.app_secrets where key = 'MCP_KEY'),
    'vapid_public_key', (select (value::jsonb) ->> 'public' from public.app_secrets where key = 'VAPID_KEYS'),
    'shortcut_url', (select value from public.app_secrets where key = 'PROJECT_URL') || '/functions/v1/shortcut',
    'shortcut_key', (select value from public.app_secrets where key = 'SHORTCUT_KEY'),
    'alarm_url', (select value from public.app_secrets where key = 'PROJECT_URL') || '/functions/v1/shortcut?alarms=1&key='
               || (select value from public.app_secrets where key = 'ALARM_KEY')
  );
end $$;
revoke all on function public.owner_settings() from public, anon;
grant execute on function public.owner_settings() to authenticated, service_role;

-- Hand out the alarms of the next 24 hours, once each (atomic).
create or replace function public.claim_alarms(p_now timestamptz) returns setof public.items
language sql security definer set search_path = public as $$
  update public.items
     set alarm_synced_at = p_now
   where alarm and alarm_synced_at is null and status = 'open'
     and remind_at > p_now + interval '30 seconds'
     and remind_at <= p_now + interval '24 hours'
  returning *;
$$;
revoke all on function public.claim_alarms(timestamptz) from public, anon, authenticated;
grant execute on function public.claim_alarms(timestamptz) to service_role;
