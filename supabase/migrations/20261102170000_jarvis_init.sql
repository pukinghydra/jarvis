-- Jarvis: VIC's personal assistant. One owner, everything locked to them.
--
-- Tables the app (logged-in owner) uses: lanes, items, captures, item_log
-- (read only), emails, briefs (read only), push_subscriptions, settings.
-- Tables only the edge functions (service role) touch: owner writes go
-- through claim_owner(), ms_tokens and sent_log have no grants at all.
--
-- The project was created with "automatically expose new tables" OFF, so
-- every grant below is explicit. anon gets nothing.
--
-- Times: timestamptz everywhere; "local" means Europe/Stockholm.

-- ── Owner ─────────────────────────────────────────────────────────────
create table public.owner (
  id int primary key default 1 check (id = 1),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.owner enable row level security;
revoke all on public.owner from anon, authenticated;

create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.owner where user_id = auth.uid());
$$;
revoke all on function public.is_owner() from public, anon;
grant execute on function public.is_owner() to authenticated;

-- The first signed-in user becomes the owner; after that nobody else can.
-- Returns true when the caller is the owner (now or already).
create or replace function public.claim_owner() returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return false; end if;
  insert into public.owner (id, user_id) values (1, auth.uid()) on conflict (id) do nothing;
  return exists (select 1 from public.owner where user_id = auth.uid());
end $$;
revoke all on function public.claim_owner() from public, anon;
grant execute on function public.claim_owner() to authenticated;

-- ── Lanes (coloured areas of life) ────────────────────────────────────
create table public.lanes (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{1,30}$'),
  name text not null,
  color text not null default '#64748B' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  description text not null default '',
  sort int not null default 100,
  created_at timestamptz not null default now()
);
insert into public.lanes (slug, name, color, description, sort) values
  ('buy',      'BUY IN',   '#F97316', 'Things to buy for Thriftin stock (Vinted, flea markets, wholesale): categories, brands, items to get more of.', 10),
  ('thriftin', 'THRIFTIN', '#22C55E', 'Running the shop: posting on TikTok/Instagram, staff, web orders, parcels, returns, shop admin.', 20),
  ('money',    'MONEY',    '#EAB308', 'Bills, payments, VAT (moms), Fortnox, taxes, subscriptions, invoices.', 30),
  ('people',   'PEOPLE',   '#EC4899', 'Friends, family, dates, birthdays, getting back to someone.', 40),
  ('life',     'LIFE',     '#3B82F6', 'Personal life: trips, hotels, health, home, admin, errands.', 50),
  ('inbox',    'INBOX',    '#8B5CF6', 'Email replies Jarvis drafted for VIC to check and send.', 60);

-- ── Notes (what VIC said or typed in the app) ─────────────────────────
-- With no Claude API key a note stays "unsorted" until Claude (in the Claude
-- app, through the MCP connector) sorts it into items. With a key set, the
-- capture function sorts it straight away ("parsed").
create table public.captures (
  id uuid primary key default gen_random_uuid(),
  short_id text generated always as (left(id::text, 8)) stored,
  text text not null,
  lang text,
  source text not null default 'app' check (source in ('app', 'voice', 'mcp', 'email', 'system')),
  status text not null default 'unsorted' check (status in ('unsorted', 'sorted', 'parsed')),
  reply text,
  result jsonb,
  sorted_at timestamptz,
  created_at timestamptz not null default now()
);
create index captures_unsorted on public.captures (created_at) where status = 'unsorted';

-- ── Emails (Hotmail via Microsoft Graph; drafts only, never sent) ──────
-- Stored as plain text for Claude (in the Claude app) to read. Flagged by
-- simple rules: keywords + VIP senders (settings). Email content is
-- untrusted data: nothing in it is ever followed as an instruction.
create table public.emails (
  id uuid primary key default gen_random_uuid(),
  short_id text generated always as (left(id::text, 8)) stored,
  graph_id text not null unique,
  received_at timestamptz,
  from_name text,
  from_address text,
  subject text,
  preview text,
  body text,
  flagged boolean not null default false,
  flag_reasons text[] not null default '{}',
  draft_id text,
  draft_text text,
  draft_language text,
  draft_web_link text,
  status text not null default 'new' check (status in ('new', 'drafted', 'handled')),
  handled_at timestamptz,
  created_at timestamptz not null default now()
);
create index emails_received on public.emails (received_at desc);
create index emails_short on public.emails (short_id);

-- ── Items (tasks, reminders, buy list, birthdays, events) ─────────────
create table public.items (
  id uuid primary key default gen_random_uuid(),
  short_id text generated always as (left(id::text, 8)) stored,
  lane_id uuid references public.lanes (id) on delete set null,
  kind text not null default 'task' check (kind in ('task', 'reminder', 'buy', 'birthday', 'event')),
  title text not null check (length(btrim(title)) > 0),
  notes text,
  status text not null default 'open' check (status in ('open', 'done', 'skipped')),
  due_at timestamptz,
  all_day boolean not null default false,
  remind_at timestamptz,
  reminded_at timestamptz,
  recur text check (recur in ('daily', 'weekdays', 'weekly', 'monthly', 'yearly')),
  proof_type text not null default 'none' check (proof_type in ('none', 'link', 'photo')),
  proof_domains text[] not null default '{}',
  proof_url text,
  proof_path text,
  skip_reason text,
  location text,
  travel_minutes int check (travel_minutes is null or travel_minutes between 0 and 600),
  alerted_on date,                       -- last day a birthday / leave-now alert went out
  source text not null default 'app' check (source in ('app', 'voice', 'mcp', 'email', 'system')),
  capture_id uuid references public.captures (id) on delete set null,
  email_id uuid references public.emails (id) on delete set null,
  done_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index items_open_due on public.items (status, due_at);
create index items_remind on public.items (remind_at) where status = 'open';
create index items_short on public.items (short_id);
create index items_lane on public.items (lane_id);

-- Proof to close, skip needs a reason. A backstop: the api and mcp
-- functions check the same rules first and give nicer messages.
create or replace function public.items_guard() returns trigger
language plpgsql set search_path = public as $$
declare host text;
begin
  if new.status = 'done' and (tg_op = 'INSERT' or old.status is distinct from 'done') then
    if new.proof_type = 'link' then
      if new.proof_url is null or new.proof_url !~* '^https?://[^/?#\s]+' then
        raise exception 'PROOF_REQUIRED: paste the link to close this';
      end if;
      host := lower(substring(new.proof_url from '^[A-Za-z]+://([^/?#:\s]+)'));
      if cardinality(new.proof_domains) > 0 and not exists (
        select 1 from unnest(new.proof_domains) d
         where host = lower(d) or host like '%.' || lower(d)) then
        raise exception 'PROOF_DOMAIN: the link must be on %', array_to_string(new.proof_domains, ' or ');
      end if;
    elsif new.proof_type = 'photo' and coalesce(new.proof_path, '') = '' then
      raise exception 'PROOF_REQUIRED: add a photo to close this';
    end if;
    new.done_at := coalesce(new.done_at, now());
  end if;
  if new.status = 'skipped' and coalesce(btrim(new.skip_reason), '') = '' then
    raise exception 'SKIP_REASON_REQUIRED: say why you are skipping';
  end if;
  if new.status = 'open' then new.done_at := null; end if;
  new.updated_at := now();
  return new;
end $$;
create trigger items_guard before insert or update on public.items
  for each row execute function public.items_guard();

-- One row per occurrence that was done, skipped or missed: streaks and the
-- weekly score are counted from here. Written by the functions only.
create table public.item_log (
  id bigint generated always as identity primary key,
  item_id uuid references public.items (id) on delete cascade,
  title text not null,
  lane_id uuid references public.lanes (id) on delete set null,
  occurred_on date not null,
  outcome text not null check (outcome in ('done', 'skipped', 'missed')),
  proof_type text not null default 'none',
  proof_url text,
  proof_path text,
  reason text,
  created_at timestamptz not null default now(),
  unique (item_id, occurred_on)
);
create index item_log_day on public.item_log (occurred_on desc);

-- ── Briefs (09:30 daily, Monday = weekly review) ──────────────────────
create table public.briefs (
  id uuid primary key default gen_random_uuid(),
  brief_date date not null unique,
  kind text not null default 'daily' check (kind in ('daily', 'weekly')),
  status text not null default 'building' check (status in ('building', 'ready', 'failed')),
  attempts int not null default 1,
  markdown text,
  push_title text,
  push_body text,
  data jsonb,
  error text,
  pushed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── Calendar (iPhone iCloud calendars via share links, optional Outlook) ─
-- Refreshed every 10 min by the tick. `calendar` = the calendar's name
-- (e.g. "Hem", "Arbete").
create table public.calendar_events (
  id text primary key,                  -- "<source>:<calendar>:<uid>:<start iso>"
  source text not null check (source in ('icloud', 'outlook')),
  calendar text not null default '',
  title text not null,
  start_at timestamptz not null,
  end_at timestamptz,
  all_day boolean not null default false,
  location text,
  synced_at timestamptz not null default now()
);
create index calendar_events_start on public.calendar_events (start_at);

-- ── Phones and laptops with alerts on ─────────────────────────────────
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  endpoint text not null unique check (endpoint ~ '^https://(fcm\.googleapis\.com|[a-z0-9.-]+\.push\.apple\.com|updates\.push\.services\.mozilla\.com|[a-z0-9.-]+\.notify\.windows\.com)/'),
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_ok_at timestamptz
);

-- ── Settings (small key/value, owner editable) ────────────────────────
create table public.settings (
  key text primary key check (key ~ '^[a-z_]{1,40}$'),
  value jsonb not null,
  updated_at timestamptz not null default now()
);
insert into public.settings (key, value) values
  ('travel_minutes', '30'::jsonb),
  ('vip_senders', '[]'::jsonb),            -- e.g. ["richie@...", "@skatteverket.se"]
  ('email_keywords_extra', '[]'::jsonb);   -- more words to flag, on top of the built-in list

-- ── Service-only tables ───────────────────────────────────────────────
-- Secrets Jarvis makes for itself, so none of them ever passes through chat
-- or a dashboard: CRON_SECRET (pg_cron -> tick), STATE_SECRET (Microsoft
-- sign-in), MCP_KEY (the Claude connector URL), PROJECT_URL, and VAPID_KEYS
-- (made by the functions on first use). Only the service role reads it.
create extension if not exists pgcrypto with schema extensions;
create table public.app_secrets (
  key text primary key,
  value text not null,
  created_at timestamptz not null default now()
);
insert into public.app_secrets (key, value) values
  ('CRON_SECRET',  encode(extensions.gen_random_bytes(32), 'hex')),
  ('STATE_SECRET', encode(extensions.gen_random_bytes(32), 'hex')),
  ('MCP_KEY',      encode(extensions.gen_random_bytes(32), 'hex')),
  ('PROJECT_URL',  'https://mcrpchqkconbesgborhj.supabase.co');

-- Microsoft refresh token. Never readable from the app.
create table public.ms_tokens (
  id int primary key default 1 check (id = 1),
  refresh_token text not null,
  account text,
  scope text,
  updated_at timestamptz not null default now()
);
-- Dedupe for alerts and scheduled runs: one row per thing already sent.
create table public.sent_log (
  key text primary key,
  sent_at timestamptz not null default now()
);

-- Reminders that are due now, claimed in one statement so two overlapping
-- ticks can't both send one. Reminders more than 12 h late are not sent
-- (after downtime they would only be noise). Service role only.
create or replace function public.claim_due_reminders(p_now timestamptz) returns setof public.items
language sql security definer set search_path = public as $$
  update public.items
     set reminded_at = p_now
   where status = 'open'
     and remind_at is not null
     and remind_at <= p_now
     and remind_at > p_now - interval '12 hours'
     and (reminded_at is null or reminded_at < remind_at)
  returning *;
$$;
revoke all on function public.claim_due_reminders(timestamptz) from public, anon, authenticated;

-- ── Seed: the two daily posting habits (proof = the post's link) ──────
-- First due today 17:00 Stockholm (or tomorrow if that already passed).
with t as (
  select case when (now() at time zone 'Europe/Stockholm')::time < time '17:00'
              then ((now() at time zone 'Europe/Stockholm')::date + time '17:00') at time zone 'Europe/Stockholm'
              else ((now() at time zone 'Europe/Stockholm')::date + 1 + time '17:00') at time zone 'Europe/Stockholm'
         end as at
)
insert into public.items (lane_id, kind, title, due_at, remind_at, recur, proof_type, proof_domains, source)
select (select id from public.lanes where slug = 'thriftin'), 'task', x.title, t.at, t.at, 'daily', 'link', x.domains, 'system'
  from t, (values ('Post on TikTok (Thriftin)', array['tiktok.com']),
                  ('Post on Instagram (Thriftin)', array['instagram.com'])) as x(title, domains);

-- ── Row level security: owner only ────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['lanes', 'items', 'captures', 'item_log', 'emails', 'briefs', 'calendar_events',
                           'push_subscriptions', 'settings', 'ms_tokens', 'sent_log', 'app_secrets'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
  foreach t in array array['lanes', 'items', 'captures', 'item_log', 'emails', 'briefs', 'calendar_events',
                           'push_subscriptions', 'settings'] loop
    execute format('create policy "owner only" on public.%I for all to authenticated using (public.is_owner()) with check (public.is_owner())', t);
  end loop;
end $$;

grant select, insert, update, delete on public.lanes, public.items, public.captures,
  public.push_subscriptions, public.settings to authenticated;
grant select, update on public.emails to authenticated;
grant select on public.item_log, public.briefs, public.calendar_events to authenticated;
-- ms_tokens, sent_log, owner, app_secrets: no grants. Service role only.

-- What the owner's Settings screen needs: the Claude connector URL and the
-- push public key. Owner only; never anon.
create or replace function public.owner_settings() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_owner() then raise exception 'NOT_OWNER'; end if;
  return jsonb_build_object(
    'mcp_url', (select value from public.app_secrets where key = 'PROJECT_URL')
               || '/functions/v1/mcp/' || (select value from public.app_secrets where key = 'MCP_KEY'),
    'vapid_public_key', (select (value::jsonb) ->> 'public' from public.app_secrets where key = 'VAPID_KEYS')
  );
end $$;
revoke all on function public.owner_settings() from public, anon;
grant execute on function public.owner_settings() to authenticated;

-- ── Storage: private bucket for photo proof ───────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('proof', 'proof', false, 10485760, array['image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp'])
on conflict (id) do nothing;

create policy "owner reads proof" on storage.objects for select to authenticated
  using (bucket_id = 'proof' and public.is_owner());
create policy "owner uploads proof" on storage.objects for insert to authenticated
  with check (bucket_id = 'proof' and public.is_owner());
create policy "owner deletes proof" on storage.objects for delete to authenticated
  using (bucket_id = 'proof' and public.is_owner());
