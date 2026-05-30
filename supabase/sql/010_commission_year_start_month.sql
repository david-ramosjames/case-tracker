-- Per-attorney commission year start month (1 = January, 12 = December).
-- Used for commission-year goals, plan rollups, and attorney historical case visibility.

alter table public.attorney_goals
  add column if not exists commission_year_start_month smallint not null default 1;

alter table public.attorney_goals
  drop constraint if exists attorney_goals_commission_year_start_month_check;

alter table public.attorney_goals
  add constraint attorney_goals_commission_year_start_month_check
  check (commission_year_start_month between 1 and 12);

comment on column public.attorney_goals.commission_year_start_month is
  'Month (1-12) when this attorney commission year begins. Goal year labels align to the calendar year in which that period starts.';
