-- Track when Case Tracker last confirmed/wrote the structured Slack channel topic.

begin;

alter table public.case_slack_channels
  add column if not exists topic_synced_at timestamptz;

comment on column public.case_slack_channels.topic_synced_at is
  'When Case Tracker last wrote or confirmed the structured Slack topic for this case channel.';

create index if not exists idx_case_slack_channels_topic_synced_at
  on public.case_slack_channels(topic_synced_at nulls first);

commit;
