-- Manual contacts logged from Slack (phone call, email, in person, and so on).
-- Replaces the Google Sheet "other" tab as the place these notes are stored.

create table if not exists public.case_client_contact_notes (
  id uuid primary key default gen_random_uuid(),
  case_number text not null,
  case_id uuid,
  contact_type text not null,
  details text,
  logged_at timestamptz not null,
  slack_channel_id text,
  slack_ts text,
  event_key text not null unique,
  source text not null default 'slack',
  created_at timestamptz not null default now()
);

create index if not exists case_client_contact_notes_case_logged
  on public.case_client_contact_notes (case_number, logged_at desc);

alter table public.case_client_contact_notes enable row level security;
revoke all on public.case_client_contact_notes from anon, authenticated;

alter table public.case_client_contact_summary
  add column if not exists last_other_type text,
  add column if not exists last_other_details text;

notify pgrst, 'reload schema';
