-- Zoom / follow-up flags for Contact Sentiment rows (one per Quo contact key).

create table if not exists public.case_client_sentiment_flags (
  case_number text not null,
  client_name text not null,
  action_required boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by text,
  primary key (case_number, client_name)
);

create index if not exists case_client_sentiment_flags_action
  on public.case_client_sentiment_flags (action_required)
  where action_required;

alter table public.case_client_sentiment_flags enable row level security;
revoke all on public.case_client_sentiment_flags from anon, authenticated;

comment on table public.case_client_sentiment_flags is
  'Contact-level Action required flags for the Contact Sentiment tab (Zoom triage).';

notify pgrst, 'reload schema';
