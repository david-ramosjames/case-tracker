-- Remember last structured topic text written/confirmed for a case channel.

begin;

alter table public.case_slack_channels
  add column if not exists topic_last_written text;

comment on column public.case_slack_channels.topic_last_written is
  'Last structured topic text Case Tracker wrote or confirmed — used to skip redundant setTopic calls.';

commit;
