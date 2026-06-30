-- Medical provider billing lines per case (e.g. from lien/reduction PDFs).

begin;

create table if not exists public.case_medical_records (
  id uuid primary key default gen_random_uuid(),
  tracker_entry_id uuid references public.case_tracker_entries(id) on delete cascade,
  case_id uuid references public.cases(id) on delete set null,
  case_number text not null,
  provider_name text not null,
  account_number text,
  date_of_service date,
  original_charges numeric(14, 2),
  current_balance numeric(14, 2),
  final_pay_amount numeric(14, 2),
  reduced_from_amount numeric(14, 2),
  payee_name text,
  payee_address text,
  dropbox_file_id text,
  dropbox_file_path text,
  review_status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint case_medical_records_review_status_check
    check (review_status in ('pending', 'in_review', 'approved', 'rejected', 'paid'))
);

create index if not exists idx_case_medical_records_case_number
  on public.case_medical_records(case_number);

create index if not exists idx_case_medical_records_tracker_entry_id
  on public.case_medical_records(tracker_entry_id);

create index if not exists idx_case_medical_records_review_status
  on public.case_medical_records(review_status);

create index if not exists idx_case_medical_records_dropbox_file_id
  on public.case_medical_records(dropbox_file_id)
  where dropbox_file_id is not null;

comment on table public.case_medical_records is
  'Medical provider billing lines keyed by case number (one case may have many providers / line items).';
comment on column public.case_medical_records.case_number is
  'RJL case number; primary key for imports when tracker row id is not known yet.';
comment on column public.case_medical_records.dropbox_file_id is
  'Stable Dropbox file id (e.g. id:…). Use this to resolve the PDF even if the path or filename changes.';
comment on column public.case_medical_records.dropbox_file_path is
  'Optional cached Dropbox path for display only; refresh from the API via dropbox_file_id when needed.';
comment on column public.case_medical_records.review_status is
  'Workflow status: pending, in_review, approved, rejected, paid.';

drop trigger if exists trg_case_medical_records_updated_at on public.case_medical_records;
create trigger trg_case_medical_records_updated_at
before update on public.case_medical_records
for each row execute function public.set_updated_at();

alter table public.case_medical_records enable row level security;

drop policy if exists "medical records readable by authenticated users" on public.case_medical_records;
create policy "medical records readable by authenticated users"
on public.case_medical_records
for select to authenticated using (true);

drop policy if exists "medical records editable by firm roles" on public.case_medical_records;
create policy "medical records editable by firm roles"
on public.case_medical_records
for all to authenticated
using (true)
with check (true);

grant select, insert, update, delete on public.case_medical_records to authenticated;

commit;
