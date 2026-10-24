-- Latest Quo client sentiment per case. The reporter upserts this instead of the
-- "All Latest Sentiment" Google Sheet. A reading older than 30 days is shown as Unknown.

create table if not exists public.case_client_sentiment (
  case_number text primary key,
  client_name text,
  sentiment text not null,
  score integer,
  reason_summary text,
  scored_at timestamptz not null,
  window_start timestamptz,
  window_end timestamptz,
  source text not null default 'quo',
  updated_at timestamptz not null default now()
);

alter table public.case_client_sentiment enable row level security;
revoke all on public.case_client_sentiment from anon, authenticated;

notify pgrst, 'reload schema';
