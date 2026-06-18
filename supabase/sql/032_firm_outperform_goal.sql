-- Firm-wide Outperform goals (not tied to a single attorney).

begin;

alter table public.attorney_goals
  add column if not exists goal_scope text not null default 'attorney';

alter table public.attorney_goals
  drop constraint if exists attorney_goals_goal_scope_check;

alter table public.attorney_goals
  add constraint attorney_goals_goal_scope_check
  check (goal_scope in ('attorney', 'firm'));

alter table public.attorney_goals
  drop constraint if exists attorney_goals_attorney_present;

alter table public.attorney_goals
  add constraint attorney_goals_attorney_present check (
    goal_scope = 'firm'
    or attorney_user_id is not null
    or attorney_name is not null
  );

create unique index if not exists attorney_goals_firm_year_unique
  on public.attorney_goals (year)
  where goal_scope = 'firm';

comment on column public.attorney_goals.goal_scope is
  'attorney = per-attorney commission goal; firm = firm-wide Outperform growth target.';

commit;
