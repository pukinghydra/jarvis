-- The tick runs as service_role; without this the 21:30 "did you post?"
-- follow-up push (claim_followups) failed with "permission denied".
grant execute on function public.claim_followups(timestamptz) to service_role;
