-- The email's Message-ID header, so Jarvis can open the email itself in the
-- iPhone Mail app (message://<id>). Filled on fetch and backfilled on recheck.
alter table public.emails add column if not exists internet_message_id text;
