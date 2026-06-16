-- Legacy cases: manually corrected disburse/settlement dates on sheet-linked rows are not overwritten by sheet sync.

begin;

alter table public.case_tracker_disbursements
  add column if not exists disburse_date_locked boolean not null default false,
  add column if not exists settlement_date_locked boolean not null default false;

comment on column public.case_tracker_disbursements.disburse_date_locked is
  'When true, sheet import does not update disburse_date or pending_remaining for this row.';

comment on column public.case_tracker_disbursements.settlement_date_locked is
  'When true, sheet import does not update settlement_date for this row.';

commit;
