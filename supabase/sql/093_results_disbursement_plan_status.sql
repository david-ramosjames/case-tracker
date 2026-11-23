-- Results meeting: disbursement plan bucket + free-form status note for Slack.
alter table public.case_tracker_results
  add column if not exists disbursement_plan text not null default '2+ Weeks';

alter table public.case_tracker_results
  add column if not exists disbursement_status_note text;

alter table public.case_tracker_results
  drop constraint if exists case_tracker_results_disbursement_plan_check;

alter table public.case_tracker_results
  add constraint case_tracker_results_disbursement_plan_check
  check (disbursement_plan in ('This Week', 'Next Week', '2+ Weeks'));
