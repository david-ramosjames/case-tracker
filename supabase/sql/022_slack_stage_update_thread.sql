-- Thread ts for "Case stage updated to …" Slack posts (attorney can reply with corrected stage).

alter table public.case_tracker_entries
  add column if not exists slack_stage_update_thread_ts text;

create index if not exists idx_case_tracker_entries_stage_update_thread
  on public.case_tracker_entries(slack_stage_update_thread_ts)
  where slack_stage_update_thread_ts is not null;
