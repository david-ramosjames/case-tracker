-- Multiple Quo directory contacts per case (e.g. co-clients on same case number).

begin;

create table if not exists public.case_quo_contacts (
  id uuid primary key default gen_random_uuid(),
  tracker_entry_id uuid not null references public.case_tracker_entries(id) on delete cascade,
  quo_contact_id text not null,
  display_name text not null,
  phone text,
  quo_conversation_id text,
  quo_phone_number_id text,
  sms_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tracker_entry_id, quo_contact_id)
);

create index if not exists idx_case_quo_contacts_tracker
  on public.case_quo_contacts (tracker_entry_id);

comment on table public.case_quo_contacts is
  'Quo directory contacts matched to a tracker case by name suffix case number.';
comment on column public.case_quo_contacts.sms_enabled is
  'When false, automations skip this contact even if a phone is present.';

alter table public.sms_pending_approvals
  add column if not exists quo_contact_id text,
  add column if not exists quo_contact_name text;

comment on column public.sms_pending_approvals.quo_contact_id is
  'Quo contact id when approval targets a specific directory contact.';
comment on column public.sms_pending_approvals.quo_contact_name is
  'Quo directory display name shown in Slack approval.';

commit;
