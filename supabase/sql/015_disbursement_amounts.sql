-- Per-party settlement amounts and fees (sub-disbursements within a case).

begin;

alter table public.case_tracker_disbursements
  add column if not exists settlement_amount numeric(14,2),
  add column if not exists attorney_fees numeric(14,2);

comment on column public.case_tracker_disbursements.label is
  'Party name from the disbursing sheet (e.g. minor claimant) — not necessarily the firm primary client.';

comment on column public.case_tracker_disbursements.settlement_amount is
  'Gross settlement for this disbursement party (sheet column J).';

comment on column public.case_tracker_disbursements.attorney_fees is
  'Net attorney fees for this disbursement party (sheet column K).';

commit;
