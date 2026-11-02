-- In-app voice chat (functions/chat) and Jarvis's long-term memory.
--
-- chat_messages: the conversation, append-only. `content` is the message
-- exactly as sent to / returned by Claude (thinking blocks included) and is
-- replayed unchanged. display_text / actions: what the app shows as a
-- bubble. usage: tokens per Claude call (cost tracking). Owner reads; only
-- the chat function (service role) writes.
create table public.chat_messages (
  id bigint generated always as identity primary key,
  thread_id uuid not null,
  role text not null check (role in ('user', 'assistant')),
  content jsonb not null,
  display_text text,
  lang text,
  actions jsonb,
  usage jsonb,
  created_at timestamptz not null default now()
);
create index chat_messages_thread on public.chat_messages (thread_id, id);
alter table public.chat_messages enable row level security;
revoke all on public.chat_messages from anon, authenticated;
grant select on public.chat_messages to authenticated;
grant select, insert, update, delete on public.chat_messages to service_role;
grant usage, select on sequence public.chat_messages_id_seq to service_role;
create policy "owner reads chat" on public.chat_messages for select to authenticated using (public.is_owner());

-- memories: durable facts about VIC that every conversation starts with
-- (Claude saves them with remember, removes them with forget). Owner reads;
-- the functions write.
create table public.memories (
  id uuid primary key default gen_random_uuid(),
  short_id text generated always as (left(id::text, 8)) stored,
  fact text not null check (length(btrim(fact)) between 1 and 1000),
  tags text[] not null default '{}',
  source text not null default 'system',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index memories_recent on public.memories (updated_at desc);
create index memories_short on public.memories (short_id);
alter table public.memories enable row level security;
revoke all on public.memories from anon, authenticated;
grant select on public.memories to authenticated;
grant select, insert, update, delete on public.memories to service_role;
create policy "owner reads memories" on public.memories for select to authenticated using (public.is_owner());

insert into public.memories (fact, tags) values
  ('VIC runs Thriftin, a vintage and thrift shop at Birkagatan 2 in Stockholm, together with Richie (co-admin).', '{thriftin,people}'),
  ('Thriftin''s till is Zettle and its webshop is Shopify; Rav builds and publishes the webshop.', '{thriftin}'),
  ('Every Thriftin item has a THR- code (e.g. THR-KNIT0001): its label, Zettle barcode and Shopify SKU.', '{thriftin}'),
  ('VIC buys stock for Thriftin on Vinted.', '{thriftin,buy}'),
  ('VIC has ADHD: he wants short, actionable answers with one next step, and wants to be challenged when he is wrong.', '{vic,preference}'),
  ('Never message or ping Richie on VIC''s behalf.', '{people,rule}'),
  ('VIC''s daily brief is at 09:30; the weekly review is on Mondays.', '{routine}'),
  ('VIC''s email is victor.bergh@hotmail.com (Hotmail). Jarvis only writes drafts there, never sends.', '{email,rule}');
