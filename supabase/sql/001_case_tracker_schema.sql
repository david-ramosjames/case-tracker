-- Ramos James Law Case Tracker
-- Tracker-specific schema only. Shared case/client fields remain in public.cases.
--
-- Assumptions:
-- - public.cases(id uuid primary key) already exists.
-- - auth.users(id uuid primary key) exists through Supabase Auth.
-- - If attorneys/paralegals are stored somewhere other than auth.users, keep the
--   nullable *_user_id columns and map them later through the service layer.

create extension if not exists pgcrypto;

do $$ begin
  create type public.case_tracker_role as enum (
    'attorney',
    'paralegal',
    'manager',
    'admin',
    'super_admin'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.case_tracker_stage as enum (
    'Intake',
    'Treatment',
    'Demand',
    'Litigation',
    'Settlement',
    'Disbursement',
    'Closed',
    'LIT',
    'SETTLED',
    'DISENGAGED'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.case_tracker_confidence as enum (
    'Low',
    'Medium',
    'High'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.case_tracker_expected_litigation as enum (
    'Pre-lit',
    'Expected litigation',
    'Litigation'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.case_tracker_comment_type as enum (
    'attorney_update',
    'manager_note',
    'risk_flag',
    'value_change',
    'general_note'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.case_tracker_signal_source as enum (
    'slack',
    'workflow',
    'matter_update',
    'manual'
  );
exception when duplicate_object then null;
end $$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.case_tracker_user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.case_tracker_role not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id)
);

drop trigger if exists trg_case_tracker_user_roles_updated_at on public.case_tracker_user_roles;
create trigger trg_case_tracker_user_roles_updated_at
before update on public.case_tracker_user_roles
for each row execute function public.set_updated_at();

create table if not exists public.case_tracker_entries (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,

  -- Forecast and operational state.
  case_stage public.case_tracker_stage not null default 'Intake',
  expected_litigation public.case_tracker_expected_litigation not null default 'Pre-lit',
  target_resolution_quarter text,
  confidence_level public.case_tracker_confidence,
  case_size text,
  liability text,

  -- Living quarterly fields.
  minimum_value numeric(14,2),
  estimated_fee_value numeric(14,2),
  case_description text not null default '',
  last_quarterly_check_in_at timestamptz,
  last_reviewed_at timestamptz,

  -- Policy capture.
  policy_limits numeric(14,2),
  policy_info_source text,
  source_of_estimate text,
  sources text not null default '',

  -- One-time setup-ish tracker fields.
  referral_fee numeric(14,2),
  referral_fee_arrangement text,
  balance_cta_info text,
  injuries text not null default '',

  -- Detail fields from the spreadsheet.
  lit_events_needed text not null default '',
  lit_events_timeline text not null default '',
  status_notes text not null default '',
  gv_notes text not null default '',
  lrj_notes text not null default '',
  forecast_notes text not null default '',
  attorney_notes text not null default '',
  manager_notes text not null default '',

  -- Workflow state.
  is_active boolean not null default true,

  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (case_id)
);

drop trigger if exists trg_case_tracker_entries_updated_at on public.case_tracker_entries;
create trigger trg_case_tracker_entries_updated_at
before update on public.case_tracker_entries
for each row execute function public.set_updated_at();

create index if not exists idx_case_tracker_entries_case_id
on public.case_tracker_entries(case_id);

create index if not exists idx_case_tracker_entries_stage
on public.case_tracker_entries(case_stage);

create index if not exists idx_case_tracker_entries_expected_litigation
on public.case_tracker_entries(expected_litigation);

create index if not exists idx_case_tracker_entries_target_quarter
on public.case_tracker_entries(target_resolution_quarter);

create index if not exists idx_case_tracker_entries_last_reviewed
on public.case_tracker_entries(last_reviewed_at);

create table if not exists public.case_tracker_results (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  tracker_entry_id uuid references public.case_tracker_entries(id) on delete cascade,

  settlement_date date,
  settlement_amount numeric(14,2),
  fee_percent numeric(5,4),
  attorney_fees numeric(14,2),
  release_signed_at timestamptz,
  closing_signed_at timestamptz,
  check_deposited_at timestamptz,
  check_disbursed_at timestamptz,
  disburse_date date,
  result_quarter text,

  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (case_id)
);

drop trigger if exists trg_case_tracker_results_updated_at on public.case_tracker_results;
create trigger trg_case_tracker_results_updated_at
before update on public.case_tracker_results
for each row execute function public.set_updated_at();

create index if not exists idx_case_tracker_results_case_id
on public.case_tracker_results(case_id);

create index if not exists idx_case_tracker_results_result_quarter
on public.case_tracker_results(result_quarter);

create index if not exists idx_case_tracker_results_disbursed
on public.case_tracker_results(check_disbursed_at);

create table if not exists public.case_tracker_comments (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  tracker_entry_id uuid references public.case_tracker_entries(id) on delete cascade,
  author_id uuid references auth.users(id) on delete set null,
  comment_type public.case_tracker_comment_type not null default 'general_note',
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_case_tracker_comments_case_id_created
on public.case_tracker_comments(case_id, created_at desc);

create table if not exists public.case_tracker_activity (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  tracker_entry_id uuid references public.case_tracker_entries(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  action text not null,
  description text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_case_tracker_activity_case_id_created
on public.case_tracker_activity(case_id, created_at desc);

create table if not exists public.case_tracker_stage_suggestions (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  tracker_entry_id uuid references public.case_tracker_entries(id) on delete cascade,
  source public.case_tracker_signal_source not null,
  suggested_stage public.case_tracker_stage not null,
  suggested_expected_litigation public.case_tracker_expected_litigation not null,
  confidence public.case_tracker_confidence not null default 'Medium',
  excerpt text not null default '',
  source_event_id text,
  detected_at timestamptz not null default now(),
  confirmed_at timestamptz,
  confirmed_by uuid references auth.users(id) on delete set null,
  dismissed_at timestamptz,
  dismissed_by uuid references auth.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_case_tracker_stage_suggestions_case_open
on public.case_tracker_stage_suggestions(case_id)
where confirmed_at is null and dismissed_at is null;

create table if not exists public.attorney_goals (
  id uuid primary key default gen_random_uuid(),
  attorney_user_id uuid references auth.users(id) on delete cascade,
  attorney_name text,
  year integer not null,
  annual_fee_goal numeric(14,2) not null default 0,
  q1_goal numeric(14,2) not null default 0,
  q2_goal numeric(14,2) not null default 0,
  q3_goal numeric(14,2) not null default 0,
  q4_goal numeric(14,2) not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint attorney_goals_attorney_present check (
    attorney_user_id is not null or attorney_name is not null
  ),
  unique (attorney_user_id, year),
  unique (attorney_name, year)
);

drop trigger if exists trg_attorney_goals_updated_at on public.attorney_goals;
create trigger trg_attorney_goals_updated_at
before update on public.attorney_goals
for each row execute function public.set_updated_at();

create index if not exists idx_attorney_goals_year
on public.attorney_goals(year);

create table if not exists public.case_tracker_snapshots (
  id uuid primary key default gen_random_uuid(),
  quarter text not null,
  snapshot_kind text not null default 'quarterly',
  captured_by uuid references auth.users(id) on delete set null,
  captured_at timestamptz not null default now(),
  notes text not null default '',
  snapshot jsonb not null
);

create index if not exists idx_case_tracker_snapshots_quarter
on public.case_tracker_snapshots(quarter, captured_at desc);

create table if not exists public.case_tracker_settings (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  value jsonb not null,
  description text not null default '',
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_case_tracker_settings_updated_at on public.case_tracker_settings;
create trigger trg_case_tracker_settings_updated_at
before update on public.case_tracker_settings
for each row execute function public.set_updated_at();

insert into public.case_tracker_settings (key, value, description)
values
  (
    'required_fields',
    '{
      "one_time": [
        "client_name",
        "date_signed",
        "date_of_incident",
        "case_type",
        "referral_fee_arrangement",
        "balance_cta_info",
        "policy_limits",
        "policy_info_source",
        "injuries"
      ],
      "quarterly": [
        "target_resolution_quarter",
        "minimum_value",
        "case_description"
      ]
    }'::jsonb,
    'Fields required once versus recurring quarterly check-in fields.'
  ),
  (
    'review_thresholds',
    '{"stale_review_days": 30, "quarterly_check_in_days": 90}'::jsonb,
    'Review freshness thresholds.'
  ),
  (
    'export_policy',
    '{"general_export_enabled": false, "admin_export_only": true}'::jsonb,
    'V1 export policy to protect sensitive client/contact data.'
  )
on conflict (key) do nothing;

create table if not exists public.case_tracker_import_batches (
  id uuid primary key default gen_random_uuid(),
  file_name text not null,
  source text not null default 'csv',
  status text not null default 'uploaded',
  total_rows integer not null default 0,
  imported_rows integer not null default 0,
  skipped_rows integer not null default 0,
  error_rows integer not null default 0,
  uploaded_by uuid references auth.users(id) on delete set null,
  uploaded_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.case_tracker_import_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.case_tracker_import_batches(id) on delete cascade,
  row_number integer not null,
  case_number text,
  case_id uuid references public.cases(id) on delete set null,
  action text not null default 'preview',
  status text not null default 'pending',
  raw_row jsonb not null default '{}'::jsonb,
  mapped_row jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists idx_case_tracker_import_rows_batch
on public.case_tracker_import_rows(batch_id, row_number);

create index if not exists idx_case_tracker_import_rows_case_number
on public.case_tracker_import_rows(case_number);

-- Helper functions for RLS.

create or replace function public.case_tracker_current_role()
returns public.case_tracker_role
language sql
stable
security definer
set search_path = public
as $$
  select role
  from public.case_tracker_user_roles
  where user_id = auth.uid()
    and active = true
  limit 1
$$;

create or replace function public.case_tracker_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    public.case_tracker_current_role() in ('admin', 'super_admin'),
    false
  )
$$;

create or replace function public.case_tracker_is_manager_or_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    public.case_tracker_current_role() in ('manager', 'admin', 'super_admin'),
    false
  )
$$;

-- Enable RLS.

alter table public.case_tracker_user_roles enable row level security;
alter table public.case_tracker_entries enable row level security;
alter table public.case_tracker_results enable row level security;
alter table public.case_tracker_comments enable row level security;
alter table public.case_tracker_activity enable row level security;
alter table public.case_tracker_stage_suggestions enable row level security;
alter table public.attorney_goals enable row level security;
alter table public.case_tracker_snapshots enable row level security;
alter table public.case_tracker_settings enable row level security;
alter table public.case_tracker_import_batches enable row level security;
alter table public.case_tracker_import_rows enable row level security;

-- Basic V1 policies.
-- These are intentionally conservative. Attorney/paralegal assigned-case filtering
-- should be tightened once we map existing DocketFlow assignment tables.

drop policy if exists "roles visible to self and admins" on public.case_tracker_user_roles;
create policy "roles visible to self and admins"
on public.case_tracker_user_roles
for select
to authenticated
using (user_id = auth.uid() or public.case_tracker_is_admin());

drop policy if exists "roles managed by admins" on public.case_tracker_user_roles;
create policy "roles managed by admins"
on public.case_tracker_user_roles
for all
to authenticated
using (public.case_tracker_is_admin())
with check (public.case_tracker_is_admin());

drop policy if exists "tracker entries readable by authenticated users" on public.case_tracker_entries;
create policy "tracker entries readable by authenticated users"
on public.case_tracker_entries
for select
to authenticated
using (true);

drop policy if exists "tracker entries editable by firm roles" on public.case_tracker_entries;
create policy "tracker entries editable by firm roles"
on public.case_tracker_entries
for all
to authenticated
using (
  public.case_tracker_current_role() in ('attorney', 'manager', 'admin', 'super_admin')
)
with check (
  public.case_tracker_current_role() in ('attorney', 'manager', 'admin', 'super_admin')
);

drop policy if exists "results readable by authenticated users" on public.case_tracker_results;
create policy "results readable by authenticated users"
on public.case_tracker_results
for select
to authenticated
using (true);

drop policy if exists "results editable by managers and admins" on public.case_tracker_results;
create policy "results editable by managers and admins"
on public.case_tracker_results
for all
to authenticated
using (public.case_tracker_is_manager_or_admin())
with check (public.case_tracker_is_manager_or_admin());

drop policy if exists "comments readable by authenticated users" on public.case_tracker_comments;
create policy "comments readable by authenticated users"
on public.case_tracker_comments
for select
to authenticated
using (true);

drop policy if exists "comments insertable by authenticated users" on public.case_tracker_comments;
create policy "comments insertable by authenticated users"
on public.case_tracker_comments
for insert
to authenticated
with check (author_id = auth.uid() or author_id is null);

drop policy if exists "activity readable by authenticated users" on public.case_tracker_activity;
create policy "activity readable by authenticated users"
on public.case_tracker_activity
for select
to authenticated
using (true);

drop policy if exists "activity insertable by authenticated users" on public.case_tracker_activity;
create policy "activity insertable by authenticated users"
on public.case_tracker_activity
for insert
to authenticated
with check (user_id = auth.uid() or user_id is null);

drop policy if exists "stage suggestions readable by authenticated users" on public.case_tracker_stage_suggestions;
create policy "stage suggestions readable by authenticated users"
on public.case_tracker_stage_suggestions
for select
to authenticated
using (true);

drop policy if exists "stage suggestions editable by firm roles" on public.case_tracker_stage_suggestions;
create policy "stage suggestions editable by firm roles"
on public.case_tracker_stage_suggestions
for all
to authenticated
using (
  public.case_tracker_current_role() in ('attorney', 'manager', 'admin', 'super_admin')
)
with check (
  public.case_tracker_current_role() in ('attorney', 'manager', 'admin', 'super_admin')
);

drop policy if exists "goals readable by authenticated users" on public.attorney_goals;
create policy "goals readable by authenticated users"
on public.attorney_goals
for select
to authenticated
using (true);

drop policy if exists "goals editable by managers and admins" on public.attorney_goals;
create policy "goals editable by managers and admins"
on public.attorney_goals
for all
to authenticated
using (public.case_tracker_is_manager_or_admin())
with check (public.case_tracker_is_manager_or_admin());

drop policy if exists "snapshots readable by authenticated users" on public.case_tracker_snapshots;
create policy "snapshots readable by authenticated users"
on public.case_tracker_snapshots
for select
to authenticated
using (true);

drop policy if exists "snapshots insertable by managers and admins" on public.case_tracker_snapshots;
create policy "snapshots insertable by managers and admins"
on public.case_tracker_snapshots
for insert
to authenticated
with check (public.case_tracker_is_manager_or_admin());

drop policy if exists "settings readable by authenticated users" on public.case_tracker_settings;
create policy "settings readable by authenticated users"
on public.case_tracker_settings
for select
to authenticated
using (true);

drop policy if exists "settings editable by admins" on public.case_tracker_settings;
create policy "settings editable by admins"
on public.case_tracker_settings
for all
to authenticated
using (public.case_tracker_is_admin())
with check (public.case_tracker_is_admin());

drop policy if exists "import batches readable by managers and admins" on public.case_tracker_import_batches;
create policy "import batches readable by managers and admins"
on public.case_tracker_import_batches
for select
to authenticated
using (public.case_tracker_is_manager_or_admin());

drop policy if exists "import batches editable by managers and admins" on public.case_tracker_import_batches;
create policy "import batches editable by managers and admins"
on public.case_tracker_import_batches
for all
to authenticated
using (public.case_tracker_is_manager_or_admin())
with check (public.case_tracker_is_manager_or_admin());

drop policy if exists "import rows readable by managers and admins" on public.case_tracker_import_rows;
create policy "import rows readable by managers and admins"
on public.case_tracker_import_rows
for select
to authenticated
using (public.case_tracker_is_manager_or_admin());

drop policy if exists "import rows editable by managers and admins" on public.case_tracker_import_rows;
create policy "import rows editable by managers and admins"
on public.case_tracker_import_rows
for all
to authenticated
using (public.case_tracker_is_manager_or_admin())
with check (public.case_tracker_is_manager_or_admin());

-- Convenience view for the app service layer. It intentionally pulls shared
-- case fields from public.cases and tracker-only fields from tracker tables.
-- Adjust selected shared columns if your final cases table differs.

create or replace view public.case_tracker_case_view as
select
  c.id as case_id,
  c.case_number,
  c.client_name,
  c.status as shared_status,
  c.case_type,
  c.date_of_incident,
  c.created_at as case_created_at,
  c.updated_at as case_updated_at,
  e.id as tracker_entry_id,
  e.case_stage,
  e.expected_litigation,
  e.target_resolution_quarter,
  e.confidence_level,
  e.case_size,
  e.liability,
  e.minimum_value,
  e.estimated_fee_value,
  e.policy_limits,
  e.policy_info_source,
  e.referral_fee,
  e.referral_fee_arrangement,
  e.balance_cta_info,
  e.injuries,
  e.case_description,
  e.sources,
  e.lit_events_needed,
  e.lit_events_timeline,
  e.status_notes,
  e.gv_notes,
  e.lrj_notes,
  e.last_reviewed_at,
  e.last_quarterly_check_in_at,
  r.settlement_date,
  r.settlement_amount,
  r.fee_percent,
  r.attorney_fees,
  r.release_signed_at,
  r.closing_signed_at,
  r.check_deposited_at,
  r.check_disbursed_at,
  r.disburse_date,
  r.result_quarter
from public.cases c
left join public.case_tracker_entries e on e.case_id = c.id
left join public.case_tracker_results r on r.case_id = c.id;

alter view public.case_tracker_case_view set (security_invoker = true);

grant usage on schema public to authenticated;
grant select on public.case_tracker_case_view to authenticated;
grant select, insert, update, delete on public.case_tracker_user_roles to authenticated;
grant select, insert, update, delete on public.case_tracker_entries to authenticated;
grant select, insert, update, delete on public.case_tracker_results to authenticated;
grant select, insert, update, delete on public.case_tracker_comments to authenticated;
grant select, insert, update, delete on public.case_tracker_activity to authenticated;
grant select, insert, update, delete on public.case_tracker_stage_suggestions to authenticated;
grant select, insert, update, delete on public.attorney_goals to authenticated;
grant select, insert, update, delete on public.case_tracker_snapshots to authenticated;
grant select, insert, update, delete on public.case_tracker_settings to authenticated;
grant select, insert, update, delete on public.case_tracker_import_batches to authenticated;
grant select, insert, update, delete on public.case_tracker_import_rows to authenticated;
