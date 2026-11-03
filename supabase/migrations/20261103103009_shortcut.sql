-- The iPhone "Jarvis Talk" shortcut: its own key (separate from the Claude
-- connector key, so either can be replaced alone), shown to the owner in
-- Settings together with the address the shortcut calls.
insert into public.app_secrets (key, value)
values ('SHORTCUT_KEY', encode(extensions.gen_random_bytes(32), 'hex'))
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
    'shortcut_key', (select value from public.app_secrets where key = 'SHORTCUT_KEY')
  );
end $$;
revoke all on function public.owner_settings() from public, anon;
grant execute on function public.owner_settings() to authenticated, service_role;
