-- Redesign (Today timeline, Focus, Mail tab):
--  - items get an emoji, a minutes estimate, a tiny first step and small
--    steps ("Split it");
--  - email no longer makes to-dos on its own (it has its own Mail tab). The
--    open to-dos it already made are put aside, reversibly:
--      update public.items set status = 'open', skip_reason = null
--      where skip_reason = 'moved to Mail tab (redesign)';
--    Vinted returns VIC must send stay open.
alter table public.items
  add column if not exists emoji text check (emoji is null or char_length(emoji) between 1 and 16),
  add column if not exists minutes int check (minutes is null or minutes between 1 and 600),
  add column if not exists first_step text check (first_step is null or char_length(first_step) <= 300),
  add column if not exists steps jsonb check (steps is null or jsonb_typeof(steps) = 'array');

update public.items i
set status = 'skipped', skip_reason = 'moved to Mail tab (redesign)', updated_at = now()
where i.status = 'open'
  and i.source = 'email'
  and i.title not ilike '%vinted%'
  and not exists (
    select 1 from public.emails e
    where e.id = i.email_id and coalesce((e.triage ->> 'vinted_return')::boolean, false)
  );
