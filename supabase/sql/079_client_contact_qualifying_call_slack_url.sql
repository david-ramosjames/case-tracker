-- Cache the Slack permalink for the specific 60+sec call that earned contact credit.

alter table public.case_client_contact_summary
  add column if not exists last_qualifying_call_slack_url text;

comment on column public.case_client_contact_summary.last_qualifying_call_slack_url is
  'Cached Slack permalink for last_qualifying_call_id (Quo router case-channel post).';

notify pgrst, 'reload schema';
