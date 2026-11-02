-- Behaviour checks on the migrated schema. Each block raises on failure.
\set ON_ERROR_STOP on
insert into auth.users values ('11111111-1111-1111-1111-111111111111', 'vic@example.com'), ('22222222-2222-2222-2222-222222222222', 'other@example.com');

-- generated secrets exist and look random
do $$ begin
  assert (select count(*) from app_secrets where key in ('CRON_SECRET','STATE_SECRET','MCP_KEY') and length(value) = 64) = 3, 'secrets';
  assert (select value from app_secrets where key = 'PROJECT_URL') = 'https://mcrpchqkconbesgborhj.supabase.co', 'project url';
  assert (select count(*) from lanes) = 6, 'lanes seeded';
  assert (select count(*) from items where recur = 'daily' and proof_type = 'link') = 2, 'posting habits seeded';
  assert (select count(*) from items i where (i.due_at at time zone 'Europe/Stockholm')::time = '17:00') = 2, 'seed at 17:00 local';
end $$;

-- owner claim: first user wins, second can't
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
do $$ begin assert public.claim_owner() = true, 'vic claims'; end $$;
do $$ begin assert (select count(*) from public.lanes) = 6, 'owner reads lanes'; end $$;
do $$ begin assert (public.owner_settings() ->> 'mcp_url') like 'https://mcrpchqkconbesgborhj.supabase.co/functions/v1/mcp/%', 'owner_settings'; end $$;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
do $$ begin assert public.claim_owner() = false, 'other cannot claim'; end $$;
do $$ begin assert (select count(*) from public.lanes) = 0, 'other reads nothing'; end $$;
do $$ begin
  begin perform public.owner_settings(); raise exception 'owner_settings should refuse'; exception when others then
    if sqlerrm not like '%NOT_OWNER%' then raise; end if; end;
end $$;
-- secrets and tokens are invisible even to the owner
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
do $$ begin
  begin perform 1 from public.app_secrets; raise exception 'app_secrets readable'; exception when insufficient_privilege then null; end;
  begin perform 1 from public.ms_tokens; raise exception 'ms_tokens readable'; exception when insufficient_privilege then null; end;
  begin perform public.claim_due_reminders(now()); raise exception 'claim_due_reminders callable'; exception when insufficient_privilege then null; end;
  begin insert into public.item_log (title, occurred_on, outcome) values ('x', current_date, 'done'); raise exception 'item_log writable'; exception when insufficient_privilege then null; end;
end $$;
reset role;

-- anon sees nothing
set role anon;
do $$ begin
  begin perform 1 from public.items; raise exception 'anon reads items'; exception when insufficient_privilege then null; end;
  begin perform public.owner_settings(); raise exception 'anon calls owner_settings'; exception when insufficient_privilege then null; end;
end $$;
reset role;

-- proof trigger
do $$
declare tik uuid;
begin
  select id into tik from items where title like 'Post on TikTok%';
  begin update items set status = 'done' where id = tik; raise exception 'closed without proof'; exception when others then if sqlerrm not like 'PROOF_REQUIRED%' then raise; end if; end;
  begin update items set status = 'done', proof_url = 'https://instagram.com/p/1' where id = tik; raise exception 'wrong domain accepted'; exception when others then if sqlerrm not like 'PROOF_DOMAIN%' then raise; end if; end;
  begin update items set status = 'done', proof_url = 'https://tiktok.com.evil.io/x' where id = tik; raise exception 'look-alike accepted'; exception when others then if sqlerrm not like 'PROOF_DOMAIN%' then raise; end if; end;
  update items set status = 'done', proof_url = 'https://vm.tiktok.com/ZM123/' where id = tik;
  assert (select done_at is not null from items where id = tik), 'done_at set';
  begin update items set status = 'open' where id = tik; end;
  begin update items set status = 'skipped' where id = tik; raise exception 'skip without reason'; exception when others then if sqlerrm not like 'SKIP_REASON_REQUIRED%' then raise; end if; end;
end $$;

-- reminders claimed once, old ones ignored
do $$
declare n int;
begin
  insert into items (title, remind_at) values ('r-now', now() - interval '1 minute'), ('r-old', now() - interval '13 hours'), ('r-future', now() + interval '1 hour');
  select count(*) into n from claim_due_reminders(now()) r where r.title like 'r-%';
  assert n = 1, format('first claim got %s', n);
  select count(*) into n from claim_due_reminders(now()) r where r.title like 'r-%';
  assert n = 0, 'second claim got something';
  update items set remind_at = now() - interval '10 seconds' where title = 'r-now' and reminded_at < now() - interval '1 second';
end $$;

-- short ids
do $$ begin assert (select bool_and(short_id = left(id::text, 8)) from items), 'short_id'; end $$;
select 'ALL SQL CHECKS PASSED' as result;
