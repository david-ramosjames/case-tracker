-- Adds explicit living workflow statuses for the Results page.
-- Existing timestamp columns remain for dates; these fields capture non-date states.

alter table public.case_tracker_results
  add column if not exists release_status text not null default 'No',
  add column if not exists closing_status text not null default 'No',
  add column if not exists check_status text not null default 'No',
  add column if not exists disbursed_status text not null default 'No';

update public.case_tracker_results
set
  release_status = case when release_signed_at is not null then 'Signed' else release_status end,
  closing_status = case when closing_signed_at is not null then 'Signed' else closing_status end,
  check_status = case when check_deposited_at is not null then 'Deposited' else check_status end,
  disbursed_status = case when check_disbursed_at is not null then 'Yes' else disbursed_status end;

