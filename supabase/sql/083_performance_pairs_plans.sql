-- Performance pairs + attorney week plans — strictly additive.
-- Creates only performance_pairs and performance_attorney_plan_lines.
-- Does NOT alter contacts, cases, settlements, or any existing tables.

create table if not exists public.performance_pairs (
  id uuid primary key default gen_random_uuid(),
  attorney_contact_id uuid null,
  paralegal_contact_id uuid null,
  attorney_label text null,
  paralegal_label text null,
  effective_from date not null default current_date,
  effective_to date null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.performance_pairs is
  'Attorney–paralegal pairs for Team weekly check rollups. Null contact + label = TBD placeholder.';

create index if not exists idx_performance_pairs_effective
  on public.performance_pairs (effective_from, effective_to);

create table if not exists public.performance_attorney_plan_lines (
  id uuid primary key default gen_random_uuid(),
  attorney_contact_id uuid not null,
  week_start date not null,
  kind text not null check (kind in ('lit_event', 'lawsuit', 'settlement')),
  case_id uuid null,
  case_number text null,
  label text not null default '',
  sort_order integer not null default 0,
  created_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.performance_attorney_plan_lines is
  'Upcoming-week attorney intent (lit kickoff, lawsuit file, settle). Never mutates case status.';

create index if not exists idx_performance_attorney_plan_lines_week
  on public.performance_attorney_plan_lines (attorney_contact_id, week_start);

alter table public.performance_pairs enable row level security;
alter table public.performance_attorney_plan_lines enable row level security;

drop policy if exists "performance_pairs_auth" on public.performance_pairs;
create policy "performance_pairs_auth" on public.performance_pairs
  for all to authenticated using (true) with check (true);

drop policy if exists "performance_attorney_plan_lines_auth" on public.performance_attorney_plan_lines;
create policy "performance_attorney_plan_lines_auth" on public.performance_attorney_plan_lines
  for all to authenticated using (true) with check (true);

grant select, insert, update, delete on public.performance_pairs to authenticated;
grant select, insert, update, delete on public.performance_attorney_plan_lines to authenticated;
