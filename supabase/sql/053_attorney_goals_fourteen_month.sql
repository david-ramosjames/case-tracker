-- Allow 14-month commission periods (e.g. first year for a new attorney).
alter table public.attorney_goals
  drop constraint if exists attorney_goals_commission_month_count_check;

alter table public.attorney_goals
  add constraint attorney_goals_commission_month_count_check
  check (commission_month_count in (12, 13, 14));

comment on column public.attorney_goals.commission_month_count is
  'Length of the commission period in months (12 standard; 13 or 14 when needed).';
