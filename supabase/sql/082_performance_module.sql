-- Goals & Performance module — strictly additive.
-- Creates only performance_* tables. Does NOT alter contacts, cases, settlements,
-- disbursements, litigation, activity, user_roles, or any existing triggers/policies.

create table if not exists public.performance_staff_dates (
  contact_id uuid primary key,
  employment_start_date date null,
  employment_end_date date null,
  updated_at timestamptz not null default now()
);

comment on table public.performance_staff_dates is
  'Performance headcount metadata keyed by contacts.id. Never unassigns cases or changes automation.';

create table if not exists public.performance_assumptions (
  id uuid primary key default gen_random_uuid(),
  settlement_to_disburse_lag_days integer not null default 42,
  aging_target_days integer not null default 30,
  aging_warn_days integer not null default 45,
  updated_at timestamptz not null default now(),
  updated_by uuid null
);

insert into public.performance_assumptions (settlement_to_disburse_lag_days, aging_target_days, aging_warn_days)
select 42, 30, 45
where not exists (select 1 from public.performance_assumptions);

create table if not exists public.performance_targets (
  id uuid primary key default gen_random_uuid(),
  metric_key text not null,
  period_grain text not null check (period_grain in ('week', 'month', 'quarter')),
  target_value numeric not null,
  scope text not null check (scope in ('firm', 'role', 'user')),
  scope_role text null,
  scope_user_id uuid null,
  effective_from date not null,
  effective_to date null,
  notes text null,
  created_by uuid null,
  created_at timestamptz not null default now()
);

create index if not exists idx_performance_targets_lookup
  on public.performance_targets (metric_key, scope, effective_from);

create table if not exists public.performance_weeks (
  id uuid primary key default gen_random_uuid(),
  week_start date not null unique,
  week_end date not null,
  status text not null default 'open' check (status in ('open', 'closed')),
  closed_at timestamptz null,
  monday_snapshot_at timestamptz null,
  created_at timestamptz not null default now()
);

create table if not exists public.performance_week_snapshots (
  id uuid primary key default gen_random_uuid(),
  week_start date not null,
  snapshot_kind text not null check (snapshot_kind in ('monday_plan', 'week_close_actuals', 'prior_week_actuals_at_monday')),
  scope text not null check (scope in ('firm', 'user')),
  scope_user_id uuid null,
  payload jsonb not null default '{}'::jsonb,
  frozen_at timestamptz not null default now(),
  frozen_by text not null default 'system',
  replaces_snapshot_id uuid null references public.performance_week_snapshots(id)
);

create index if not exists idx_performance_week_snapshots_week
  on public.performance_week_snapshots (week_start, snapshot_kind);

create table if not exists public.performance_deliverables (
  id uuid primary key default gen_random_uuid(),
  case_id uuid null,
  case_number text not null,
  client_name_snapshot text null,
  deliverable_type text not null,
  identity_key text not null,
  identity_label text null,
  attorney_user_id uuid null,
  assignee_user_id uuid null,
  identified_at timestamptz not null default now(),
  identified_by uuid null,
  workflow_status text not null default 'backlog'
    check (workflow_status in ('backlog', 'committed', 'done', 'cancelled')),
  requested_completion_date date null,
  planned_date date null,
  completed_at timestamptz null,
  completion_source text null check (completion_source is null or completion_source in ('manual', 'confirmed_event', 'system')),
  reschedule_count integer not null default 0,
  lit_person_name text null,
  hearing_type text null,
  document_label text null,
  round_number integer null,
  recipient_label text null,
  docket_event_id uuid null,
  notes text null,
  cancel_reason text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_performance_deliverables_open_identity
  on public.performance_deliverables (case_id, deliverable_type, identity_key)
  where workflow_status in ('backlog', 'committed');

create index if not exists idx_performance_deliverables_assignee
  on public.performance_deliverables (assignee_user_id, workflow_status);

create index if not exists idx_performance_deliverables_attorney
  on public.performance_deliverables (attorney_user_id, workflow_status);

create table if not exists public.performance_commitments (
  id uuid primary key default gen_random_uuid(),
  deliverable_id uuid not null references public.performance_deliverables(id) on delete cascade,
  week_start date not null,
  committed_by uuid null,
  committed_at timestamptz not null default now(),
  planned_date date null,
  outcome text not null default 'promised'
    check (outcome in ('promised', 'completed', 'missed', 'cancelled', 'moved')),
  moved_to_week_start date null,
  monday_snapshot_id uuid null references public.performance_week_snapshots(id),
  cancel_reason text null
);

create index if not exists idx_performance_commitments_week
  on public.performance_commitments (week_start, outcome);

create index if not exists idx_performance_commitments_deliverable
  on public.performance_commitments (deliverable_id);

create table if not exists public.performance_deliverable_events (
  id uuid primary key default gen_random_uuid(),
  deliverable_id uuid not null references public.performance_deliverables(id) on delete cascade,
  commitment_id uuid null references public.performance_commitments(id) on delete set null,
  actor_user_id uuid null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_performance_deliverable_events_deliverable
  on public.performance_deliverable_events (deliverable_id, created_at);

create table if not exists public.performance_score_adjustments (
  id uuid primary key default gen_random_uuid(),
  week_start date not null,
  scope_user_id uuid null,
  metric_key text not null,
  delta numeric not null default 0,
  reason text not null,
  actor_user_id uuid null,
  created_at timestamptz not null default now()
);

alter table public.performance_staff_dates enable row level security;
alter table public.performance_assumptions enable row level security;
alter table public.performance_targets enable row level security;
alter table public.performance_weeks enable row level security;
alter table public.performance_week_snapshots enable row level security;
alter table public.performance_deliverables enable row level security;
alter table public.performance_commitments enable row level security;
alter table public.performance_deliverable_events enable row level security;
alter table public.performance_score_adjustments enable row level security;

drop policy if exists "performance_staff_dates_auth" on public.performance_staff_dates;
create policy "performance_staff_dates_auth" on public.performance_staff_dates
  for all to authenticated using (true) with check (true);

drop policy if exists "performance_assumptions_auth" on public.performance_assumptions;
create policy "performance_assumptions_auth" on public.performance_assumptions
  for all to authenticated using (true) with check (true);

drop policy if exists "performance_targets_auth" on public.performance_targets;
create policy "performance_targets_auth" on public.performance_targets
  for all to authenticated using (true) with check (true);

drop policy if exists "performance_weeks_auth" on public.performance_weeks;
create policy "performance_weeks_auth" on public.performance_weeks
  for all to authenticated using (true) with check (true);

drop policy if exists "performance_week_snapshots_auth" on public.performance_week_snapshots;
create policy "performance_week_snapshots_auth" on public.performance_week_snapshots
  for all to authenticated using (true) with check (true);

drop policy if exists "performance_deliverables_auth" on public.performance_deliverables;
create policy "performance_deliverables_auth" on public.performance_deliverables
  for all to authenticated using (true) with check (true);

drop policy if exists "performance_commitments_auth" on public.performance_commitments;
create policy "performance_commitments_auth" on public.performance_commitments
  for all to authenticated using (true) with check (true);

drop policy if exists "performance_deliverable_events_auth" on public.performance_deliverable_events;
create policy "performance_deliverable_events_auth" on public.performance_deliverable_events
  for all to authenticated using (true) with check (true);

drop policy if exists "performance_score_adjustments_auth" on public.performance_score_adjustments;
create policy "performance_score_adjustments_auth" on public.performance_score_adjustments
  for all to authenticated using (true) with check (true);

grant select, insert, update, delete on public.performance_staff_dates to authenticated;
grant select, insert, update, delete on public.performance_assumptions to authenticated;
grant select, insert, update, delete on public.performance_targets to authenticated;
grant select, insert, update, delete on public.performance_weeks to authenticated;
grant select, insert, update, delete on public.performance_week_snapshots to authenticated;
grant select, insert, update, delete on public.performance_deliverables to authenticated;
grant select, insert, update, delete on public.performance_commitments to authenticated;
grant select, insert, update, delete on public.performance_deliverable_events to authenticated;
grant select, insert, update, delete on public.performance_score_adjustments to authenticated;
