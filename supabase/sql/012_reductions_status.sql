-- Reductions workflow status on settled case results.

alter table public.case_tracker_results
  add column if not exists reductions_status text not null default 'Not Complete';
