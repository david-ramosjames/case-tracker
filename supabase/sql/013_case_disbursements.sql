-- Multiple disbursements per case (e.g. mother/child) with fractional commission weighting.
-- Synced from RJL Cases Disbursing; total slots = rows per case; column B pending flag; dates from H and Z.

begin;

alter table public.case_tracker_entries
  add column if not exists expected_disbursement_count integer not null default 1;

comment on column public.case_tracker_entries.expected_disbursement_count is
  'Total disbursement rows for this case on the sheet (e.g. 2 for mother/child). Each row counts as 1/count toward commission.';

create table if not exists public.case_tracker_disbursements (
  id uuid primary key default gen_random_uuid(),
  tracker_entry_id uuid references public.case_tracker_entries(id) on delete cascade,
  case_id uuid references public.cases(id) on delete set null,
  case_number text not null,
  disburse_date date,
  settlement_date date,
  weight numeric(10, 6) not null default 1,
  label text,
  sheet_row_key text,
  synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists case_tracker_disbursements_sheet_row_key_unique
  on public.case_tracker_disbursements(sheet_row_key)
  where sheet_row_key is not null;

create index if not exists idx_case_tracker_disbursements_case_number
  on public.case_tracker_disbursements(case_number);

create index if not exists idx_case_tracker_disbursements_tracker_entry_id
  on public.case_tracker_disbursements(tracker_entry_id);

drop trigger if exists trg_case_tracker_disbursements_updated_at on public.case_tracker_disbursements;
create trigger trg_case_tracker_disbursements_updated_at
before update on public.case_tracker_disbursements
for each row execute function public.set_updated_at();

alter table public.case_tracker_disbursements enable row level security;

drop policy if exists "disbursements readable by authenticated users" on public.case_tracker_disbursements;
create policy "disbursements readable by authenticated users"
on public.case_tracker_disbursements
for select to authenticated using (true);

drop policy if exists "disbursements editable by firm roles" on public.case_tracker_disbursements;
create policy "disbursements editable by firm roles"
on public.case_tracker_disbursements
for all to authenticated
using (true)
with check (true);

grant select, insert, update, delete on public.case_tracker_disbursements to authenticated;

commit;
