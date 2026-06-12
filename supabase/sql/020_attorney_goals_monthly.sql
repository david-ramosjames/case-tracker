alter table public.attorney_goals
  add column if not exists monthly_goals jsonb not null default '{}'::jsonb;

comment on column public.attorney_goals.monthly_goals is
  'Monthly fee targets keyed by YYYY-MM for the attorney commission year. Q1–Q4 are derived on save.';
