-- Restore Not Complete as a reductions option (024 no longer remaps it).

begin;

alter table public.case_tracker_results
  alter column reductions_status set default 'Not Complete';

commit;
