-- Slack channel mapping, reminder tracking, and sources/lit review timestamps.

begin;

alter table public.case_tracker_entries
  add column if not exists last_sources_lit_updated_at timestamptz,
  add column if not exists last_slack_reminder_at timestamptz,
  add column if not exists slack_reminder_thread_ts text;

create table if not exists public.case_slack_channels (
  case_number text primary key,
  slack_channel_id text,
  slack_channel_name text not null,
  topic_stage text,
  synced_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_case_slack_channels_channel_id
  on public.case_slack_channels(slack_channel_id);

create index if not exists idx_case_slack_channels_channel_name
  on public.case_slack_channels(lower(slack_channel_name));

comment on table public.case_slack_channels is
  'Maps DocketFlow case numbers to Slack case channels (synced from Google Sheet or admin import).';

commit;
