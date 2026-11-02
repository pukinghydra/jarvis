-- The edge functions use the service role. The project has "automatically
-- expose new tables" OFF, which also leaves service_role without table
-- grants (it bypasses RLS, but still needs GRANTs). Found on deploy: every
-- function read of app_secrets failed with permission denied.
grant usage on schema public to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
grant execute on function public.claim_due_reminders(timestamptz) to service_role;
grant execute on function public.is_owner(), public.claim_owner(), public.owner_settings() to service_role;

-- Tables and sequences added by later migrations get the same.
alter default privileges in schema public grant select, insert, update, delete on tables to service_role;
alter default privileges in schema public grant usage, select on sequences to service_role;
