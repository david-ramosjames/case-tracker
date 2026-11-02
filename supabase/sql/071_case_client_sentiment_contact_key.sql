-- Weekly sentiment is one reading per Quo contact (client display name), not per case.
-- event_key format from the reporter: quo:{clientKey}:{window_start}:{window_end}
-- case_number remains for joining open matters; multiple contacts may share a case #.

comment on table public.case_client_sentiment is
  'Weekly Quo client sentiment at contact level (client_name = Quo contact key). Multiple contacts may share a case_number.';

create index if not exists case_client_sentiment_client_scored
  on public.case_client_sentiment (client_name, scored_at desc);

notify pgrst, 'reload schema';
