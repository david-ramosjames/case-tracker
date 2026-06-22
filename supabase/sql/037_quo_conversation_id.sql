-- Deep link to Quo inbox conversation from case pages (resolved during phone sync).

begin;

alter table public.case_tracker_entries
  add column if not exists quo_conversation_id text;

comment on column public.case_tracker_entries.quo_conversation_id is
  'Quo conversation id (CN…) for inbox deep link; resolved from client phone during Quo sync.';

commit;
