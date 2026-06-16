-- Align reductions_status labels with tracker UI options.

begin;

update public.case_tracker_results
set reductions_status = 'Sent, Not Approved'
where reductions_status = 'Sent';

update public.case_tracker_results
set reductions_status = 'To Be Sent'
where reductions_status in ('Not Complete', 'Deposited', 'N/A', '');

alter table public.case_tracker_results
  alter column reductions_status set default 'To Be Sent';

commit;
