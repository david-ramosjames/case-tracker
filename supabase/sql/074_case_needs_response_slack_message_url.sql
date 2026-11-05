alter table public.case_needs_response
  add column if not exists slack_message_url text;

comment on column public.case_needs_response.slack_message_url is
  'Permalink to the Quo Router Slack post for this item, when known.';

notify pgrst, 'reload schema';
