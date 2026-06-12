alter table public.attorney_goals
  add column if not exists commission_month_count integer not null default 12
  check (commission_month_count in (12, 13));

comment on column public.attorney_goals.commission_month_count is
  'Length of the commission period in months (12 standard, 13 when needed).';
