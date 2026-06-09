-- Opt-in multi-disbursement tracking (default single disbursement per case).

begin;

alter table public.case_tracker_entries
  add column if not exists multiple_disbursements_enabled boolean not null default false;

comment on column public.case_tracker_entries.multiple_disbursements_enabled is
  'When true, the case uses multiple disbursement parties (e.g. parent + minor). Default false for typical single-disbursement cases.';

commit;
