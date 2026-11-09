-- Point Call 60+sec at the Quo call (and later the case Slack post) that earned it.

alter table public.case_client_contact_summary
  add column if not exists last_qualifying_call_id text,
  add column if not exists last_qualifying_call_phone_number_id text,
  add column if not exists last_qualifying_call_conversation_id text;

comment on column public.case_client_contact_summary.last_qualifying_call_id is
  'Quo call id (AC…) for last_qualifying_call_at — used to open the Quo router Slack post.';

notify pgrst, 'reload schema';
