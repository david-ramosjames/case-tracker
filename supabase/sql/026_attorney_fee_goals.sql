alter table public.attorney_goals
  add column if not exists monthly_fee_goals jsonb not null default '{}'::jsonb,
  add column if not exists fee_q1_goal numeric(14,2) not null default 0,
  add column if not exists fee_q2_goal numeric(14,2) not null default 0,
  add column if not exists fee_q3_goal numeric(14,2) not null default 0,
  add column if not exists fee_q4_goal numeric(14,2) not null default 0;

comment on column public.attorney_goals.monthly_fee_goals is
  'Monthly RJL attorney fees targets keyed by YYYY-MM. Separate from commission threshold.';
