-- Ramos James Law Case Tracker
-- Store DOL on orphaned tracker rows that are not linked to DocketFlow cases.

begin;

alter table public.case_tracker_entries
  add column if not exists date_of_incident_override date;

comment on column public.case_tracker_entries.date_of_incident_override is
  'Optional DOL for tracker-only rows. Linked cases use cases.date_of_incident instead.';

commit;
