-- Stage confirmation workflow: Pulse → per-channel Slack confirm → tracker update

do $$ begin
  alter type public.case_tracker_signal_source add value if not exists 'pulse';
exception when duplicate_object then null;
end $$;

do $$ begin
  alter type public.case_tracker_signal_source add value if not exists 'sheet';
exception when duplicate_object then null;
end $$;

alter table public.case_tracker_stage_suggestions
  add column if not exists slack_channel_id text,
  add column if not exists slack_confirmation_thread_ts text,
  add column if not exists confirmation_posted_at timestamptz;

create index if not exists idx_case_tracker_stage_suggestions_slack_thread
  on public.case_tracker_stage_suggestions(slack_confirmation_thread_ts)
  where slack_confirmation_thread_ts is not null and confirmed_at is null and dismissed_at is null;

insert into public.case_tracker_settings (key, value, description)
values (
  'daily_pulse_last_ts',
  'null'::jsonb,
  'Slack message ts of the last processed #daily-pulse recap (string or null).'
)
on conflict (key) do nothing;
