-- Quo call/SMS evidence URLs from the weekly sentiment reporter (same links as the email).

alter table public.case_client_sentiment
  add column if not exists evidence_urls text;

comment on column public.case_client_sentiment.evidence_urls is
  'Space-separated Quo call/SMS URLs that grounded this weekly reading.';

notify pgrst, 'reload schema';
