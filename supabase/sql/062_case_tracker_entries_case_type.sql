-- Tracker rows not linked to a DocketFlow case store their own case type.
-- Linked rows keep reading/writing cases.case_type.

alter table public.case_tracker_entries
  add column if not exists case_type text;

comment on column public.case_tracker_entries.case_type is
  'Case type for tracker rows not linked to a DocketFlow case (linked rows use cases.case_type).';

notify pgrst, 'reload schema';
