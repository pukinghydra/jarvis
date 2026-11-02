-- Jarvis heartbeat: call the `tick` function every minute.
-- Run once in the SQL editor AFTER the functions are deployed. Nothing to
-- fill in: the URL and the secret are read from public.app_secrets (made by
-- the migration) each time the job runs.

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

select cron.schedule(
  'jarvis-tick',
  '* * * * *',
  $$
  select net.http_post(
    url := (select value from public.app_secrets where key = 'PROJECT_URL') || '/functions/v1/tick',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select value from public.app_secrets where key = 'CRON_SECRET')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);

-- Check it runs (wait 2 minutes):
--   select status, return_message, start_time from cron.job_run_details order by start_time desc limit 5;
--   select status_code, content::text from net._http_response order by created desc limit 5;
-- Stop it:
--   select cron.unschedule('jarvis-tick');
