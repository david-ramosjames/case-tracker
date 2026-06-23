-- Quo inbox deep links require both phone line id (PN…) and conversation id (CN…).

begin;

alter table public.case_tracker_entries
  add column if not exists quo_phone_number_id text;

comment on column public.case_tracker_entries.quo_phone_number_id is
  'Quo phone number id (PN…) for inbox deep link; paired with quo_conversation_id.';

commit;
