-- Morning Client Needs Response queue from quo-reporting
-- (missed / Sona calls, callback-owed, inbound texts needing staff follow-up).

create table if not exists public.case_needs_response (
  id uuid primary key default gen_random_uuid(),
  case_number text not null,
  case_id uuid,
  client_name text not null,
  phone text,
  channel text not null default 'call'
    check (channel in ('call', 'sms', 'both')),
  reason text not null,
  reason_code text not null default 'other'
    check (reason_code in ('missed_call', 'sona', 'callback', 'sms', 'other')),
  status text not null default 'open'
    check (status in ('open', 'resolved', 'dismissed')),
  detected_at timestamptz not null,
  report_window_label text,
  attorney_name text,
  paralegal_name text,
  quo_line text,
  evidence_url text,
  details text,
  event_key text not null,
  source text not null default 'quo-reporting',
  resolved_at timestamptz,
  resolved_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists case_needs_response_event_key
  on public.case_needs_response (event_key);

create index if not exists case_needs_response_status_detected
  on public.case_needs_response (status, detected_at desc);

create index if not exists case_needs_response_case_status
  on public.case_needs_response (case_number, status);

alter table public.case_needs_response enable row level security;
revoke all on public.case_needs_response from anon, authenticated;

comment on table public.case_needs_response is
  'Clients the firm still owes a response (missed/Sona call, promised callback, or inbound text). Synced from the morning quo-reporting job.';

notify pgrst, 'reload schema';
