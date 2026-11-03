-- Jarvis can change VIC's iCloud events over CalDAV: each synced event keeps
-- where it lives (href) and its version (etag), and gets a short id Claude
-- can name ("ev 1a2b3c4d"). Rows still come from source 'icloud'; href is
-- null for rows that came from a read-only share link.
alter table public.calendar_events
  add column if not exists href text,
  add column if not exists etag text,
  add column if not exists uid text,
  add column if not exists short_id text generated always as (left(md5(id), 8)) stored;
create index if not exists calendar_events_short on public.calendar_events (short_id);
create index if not exists calendar_events_href on public.calendar_events (href);

-- Where new events go unless VIC names a calendar (owner can change it).
insert into public.settings (key, value) values ('default_calendar', '"Arbete"'::jsonb)
on conflict (key) do nothing;
