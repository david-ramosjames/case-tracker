-- Cache Sentiment evidence Slack permalinks + date labels so Contact does not
-- depend on a short page-load Slack crawl.

alter table public.case_client_sentiment
  add column if not exists evidence_resolved jsonb;

comment on column public.case_client_sentiment.evidence_resolved is
  'Cached Sentiment evidence items with Slack permalinks and date labels.';

notify pgrst, 'reload schema';
