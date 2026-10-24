-- Sentiment is a history log: one row per weekly reading, not one row per case.

alter table public.case_client_sentiment drop constraint if exists case_client_sentiment_pkey;

alter table public.case_client_sentiment
  add column if not exists id uuid default gen_random_uuid();

update public.case_client_sentiment set id = gen_random_uuid() where id is null;

alter table public.case_client_sentiment alter column id set not null;
alter table public.case_client_sentiment add primary key (id);

alter table public.case_client_sentiment
  add column if not exists event_key text,
  add column if not exists week_label text;

update public.case_client_sentiment
set event_key = 'summary:' || case_number
where event_key is null;

alter table public.case_client_sentiment alter column event_key set not null;

create unique index if not exists case_client_sentiment_event_key
  on public.case_client_sentiment (event_key);

create index if not exists case_client_sentiment_case_scored
  on public.case_client_sentiment (case_number, scored_at desc);

notify pgrst, 'reload schema';
