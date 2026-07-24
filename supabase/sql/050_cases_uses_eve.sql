-- Track whether a case uses Eve (shown as :eve-logo: in the Slack channel topic).

begin;

alter table public.cases
  add column if not exists uses_eve boolean not null default false;

alter table public.cases
  add column if not exists responsible_attorney_contact_id uuid references public.contacts(id) on delete set null;

create index if not exists idx_cases_responsible_attorney
  on public.cases (responsible_attorney_contact_id);

comment on column public.cases.uses_eve is
  'When true, Slack case channel topics include :eve-logo:.';

comment on column public.cases.responsible_attorney_contact_id is
  'Primary responsible attorney contact (kept in sync with assigned_contact_ids[0] attorney).';

commit;
