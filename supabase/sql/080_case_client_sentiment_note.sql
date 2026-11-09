-- Persist the latest Sentiment-tab note so it remains visible in Contact → Notes.

alter table public.case_client_sentiment_flags
  add column if not exists note text,
  add column if not exists note_updated_at timestamptz;

comment on column public.case_client_sentiment_flags.note is
  'Latest Sentiment-tab note posted to Slack / case tracker for this contact.';

notify pgrst, 'reload schema';
