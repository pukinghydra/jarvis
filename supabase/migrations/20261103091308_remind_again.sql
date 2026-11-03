-- "Remind me again if I haven't done it": a second push remind_again_minutes
-- after remind_at while the item is still open (e.g. TikTok 20:30, again
-- 21:30). Once per occurrence: reminded_again_at older than remind_at means
-- this occurrence hasn't had its second push yet.
alter table public.items
  add column remind_again_minutes int check (remind_again_minutes is null or remind_again_minutes between 5 and 720),
  add column reminded_again_at timestamptz;

create or replace function public.claim_followups(p_now timestamptz) returns setof public.items
language sql security definer set search_path = public as $$
  update public.items
     set reminded_again_at = p_now
   where status = 'open'
     and remind_again_minutes is not null
     and remind_at is not null
     and reminded_at is not null and reminded_at >= remind_at
     and p_now >= remind_at + make_interval(mins => remind_again_minutes)
     and p_now < remind_at + make_interval(mins => remind_again_minutes) + interval '6 hours'
     and (reminded_again_at is null or reminded_again_at < remind_at)
  returning *;
$$;
revoke all on function public.claim_followups(timestamptz) from public, anon, authenticated;
