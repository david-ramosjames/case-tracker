-- Lock settlement financial fields imported via CSV so disbursing sheet sync does not overwrite them.

begin;

alter table public.case_tracker_results
  add column if not exists financial_backfill_locked boolean not null default false;

alter table public.case_tracker_entries
  add column if not exists referral_fee_backfill_locked boolean not null default false;

comment on column public.case_tracker_results.financial_backfill_locked is
  'When true, Google Sheet settlement sync skips this case (amounts/dates stay from CSV backfill).';

comment on column public.case_tracker_entries.referral_fee_backfill_locked is
  'When true, referral fee was set via financial CSV backfill and should not be cleared by imports.';

commit;
