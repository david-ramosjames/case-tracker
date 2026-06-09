-- Column B on the settlements sheet: non-blank while waiting to disburse, blank once disbursed.

begin;

alter table public.case_tracker_disbursements
  add column if not exists pending_remaining boolean not null default false;

comment on column public.case_tracker_disbursements.pending_remaining is
  'Synced from sheet column B: true while this disbursement row is still outstanding; false when B is blank (disbursed).';

commit;
