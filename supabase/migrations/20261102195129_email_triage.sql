-- AI email triage (only runs when an Anthropic API key is set) and VIC's
-- writing style for reply drafts.
--
-- emails: what Claude made of each message. triaged_at null = not sorted
-- yet (the next run picks it up).
alter table public.emails
  add column if not exists importance text check (importance in ('urgent', 'important', 'normal', 'noise')),
  add column if not exists summary text,
  add column if not exists why text,
  add column if not exists needs_reply boolean,
  add column if not exists reply_language text,
  add column if not exists triaged_at timestamptz,
  add column if not exists triage jsonb;

create index if not exists emails_untriaged on public.emails (received_at desc) where triaged_at is null;
create index if not exists emails_importance on public.emails (importance, status);

-- Short examples of VIC's own sent replies (his text only, never anyone
-- else's), picked when Jarvis learns his style. Used as few-shot examples
-- for drafts. Service role only: no grants to the app.
create table if not exists public.style_examples (
  id uuid primary key default gen_random_uuid(),
  language text not null,
  subject text,
  domain text,
  body text not null,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.style_examples enable row level security;
revoke all on public.style_examples from anon, authenticated;
grant select, insert, update, delete on public.style_examples to service_role;

-- The style guide itself lives in settings (owner can read and edit it):
--   writing_style           {"sv": "...", "en": "...", "built_at": "...", "samples": n}
--   writing_style_edited_at "2026-11-02T20:00:00Z" when VIC last edited it
insert into public.settings (key, value) values ('writing_style', '{}'::jsonb)
on conflict (key) do nothing;
