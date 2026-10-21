-- Client contact log. Quo calls/texts, outbound SMS, and Slack @mentions each write an event.
-- case_client_contact_latest is the one row per case the Client contact tab reads.

create table if not exists public.case_client_contact_events (
  id uuid primary key default gen_random_uuid(),
  case_id uuid,
  case_number text not null,
  contacted_at timestamptz not null,
  source text not null check (source in ('quo', 'sms', 'slack')),
  contact_type text,
  details text,
  phone text,
  external_id text not null,
  created_at timestamptz not null default now(),
  constraint case_client_contact_events_dedupe unique (source, external_id, case_number)
);

create index if not exists case_client_contact_events_case_idx
  on public.case_client_contact_events (case_number, contacted_at desc);

create table if not exists public.case_client_contact_latest (
  case_number text primary key,
  case_id uuid,
  contacted_at timestamptz not null,
  source text not null,
  contact_type text,
  details text,
  phone text,
  updated_at timestamptz not null default now()
);

alter table public.case_client_contact_events enable row level security;
alter table public.case_client_contact_latest enable row level security;
revoke all on public.case_client_contact_events from anon, authenticated;
revoke all on public.case_client_contact_latest from anon, authenticated;

notify pgrst, 'reload schema';
