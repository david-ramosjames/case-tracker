-- Ensure slack_stage_update_thread_ts exists (022 may not have been applied in some envs).
-- Fixes: column case_tracker_entries.slack_stage_update_thread_ts does not exist (42703)

begin;

alter table public.case_tracker_entries
  add column if not exists slack_stage_update_thread_ts text;

create index if not exists idx_case_tracker_entries_stage_update_thread
  on public.case_tracker_entries(slack_stage_update_thread_ts)
  where slack_stage_update_thread_ts is not null;

commit;
