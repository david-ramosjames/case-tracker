-- Client SMS automations via Quo API with Slack approval before send.

begin;

alter table public.case_tracker_entries
  add column if not exists client_phone text,
  add column if not exists quo_contact_id text;

comment on column public.case_tracker_entries.client_phone is
  'Client mobile in E.164 format for Quo SMS; synced from Quo directory or edited manually.';
comment on column public.case_tracker_entries.quo_contact_id is
  'Quo contact id when phone was synced from the Quo directory.';

-- Preferred language lives on public.cases.preferred_language (DocketFlow).

create table if not exists public.sms_automations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  enabled boolean not null default true,
  from_stage text not null,
  to_stage text not null,
  case_types text[] not null default '{}',
  message_en text not null,
  message_es text not null,
  youtube_url_en text,
  youtube_url_es text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_sms_automations_enabled_stages
  on public.sms_automations (enabled, from_stage, to_stage);

create table if not exists public.sms_pending_approvals (
  id uuid primary key default gen_random_uuid(),
  case_id text not null,
  tracker_entry_id uuid references public.case_tracker_entries(id) on delete set null,
  automation_id uuid references public.sms_automations(id) on delete set null,
  case_number text not null,
  client_name text,
  phone text not null,
  language text not null check (language in ('en', 'es')),
  message_body text not null,
  from_stage text not null,
  to_stage text not null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'sent', 'failed', 'cancelled')),
  slack_channel_id text,
  slack_thread_ts text,
  quo_message_id text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz
);

create index if not exists idx_sms_pending_approvals_status
  on public.sms_pending_approvals (status, created_at desc);

create index if not exists idx_sms_pending_approvals_slack_thread
  on public.sms_pending_approvals (slack_channel_id, slack_thread_ts)
  where slack_thread_ts is not null;

commit;
