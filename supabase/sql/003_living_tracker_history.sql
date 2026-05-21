-- Ramos James Law Case Tracker
-- Living tracker history.
--
-- Run after:
-- 001_case_tracker_schema.sql
-- 002_docketflow_sync_and_soft_unlink.sql
--
-- Purpose:
-- - Keep case_tracker_entries as the current living tracker row.
-- - Record structured versions when important forecast/check-in fields change.
-- - Keep case_tracker_snapshots as optional quarter freeze frames, not the main
--   working data model.

begin;

create table if not exists public.case_tracker_entry_versions (
  id uuid primary key default gen_random_uuid(),
  tracker_entry_id uuid not null references public.case_tracker_entries(id) on delete cascade,
  case_id uuid references public.cases(id) on delete set null,
  case_number text,

  version_number integer not null,
  changed_at timestamptz not null default now(),
  changed_by uuid references auth.users(id) on delete set null,
  change_source text not null default 'manual',
  change_reason text,
  review_kind text,

  changed_fields text[] not null default '{}'::text[],
  old_values jsonb not null default '{}'::jsonb,
  new_values jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  unique (tracker_entry_id, version_number)
);

create index if not exists idx_case_tracker_entry_versions_tracker_created
on public.case_tracker_entry_versions(tracker_entry_id, changed_at desc);

create index if not exists idx_case_tracker_entry_versions_case_id
on public.case_tracker_entry_versions(case_id, changed_at desc);

create index if not exists idx_case_tracker_entry_versions_case_number
on public.case_tracker_entry_versions(case_number);

create index if not exists idx_case_tracker_entry_versions_changed_fields
on public.case_tracker_entry_versions using gin(changed_fields);

alter table public.case_tracker_entry_versions enable row level security;

drop policy if exists "entry versions readable by authenticated users" on public.case_tracker_entry_versions;
create policy "entry versions readable by authenticated users"
on public.case_tracker_entry_versions
for select
to authenticated
using (true);

drop policy if exists "entry versions insertable by firm roles" on public.case_tracker_entry_versions;
create policy "entry versions insertable by firm roles"
on public.case_tracker_entry_versions
for insert
to authenticated
with check (
  public.case_tracker_current_role() in ('attorney', 'manager', 'admin', 'super_admin')
);

drop policy if exists "entry versions manageable by admins" on public.case_tracker_entry_versions;
create policy "entry versions manageable by admins"
on public.case_tracker_entry_versions
for update
to authenticated
using (public.case_tracker_is_admin())
with check (public.case_tracker_is_admin());

drop policy if exists "entry versions deletable by admins" on public.case_tracker_entry_versions;
create policy "entry versions deletable by admins"
on public.case_tracker_entry_versions
for delete
to authenticated
using (public.case_tracker_is_admin());

-- Optional per-request metadata. The app can set these before an update:
--
-- select set_config('case_tracker.change_reason', 'Quarterly check-in', true);
-- select set_config('case_tracker.change_source', 'app', true);
-- select set_config('case_tracker.review_kind', 'quarterly_check_in', true);
--
-- If not set, the trigger uses safe defaults.

create or replace function public.case_tracker_tracked_entry_json(entry public.case_tracker_entries)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'case_stage', entry.case_stage,
    'expected_litigation', entry.expected_litigation,
    'target_resolution_quarter', entry.target_resolution_quarter,
    'confidence_level', entry.confidence_level,
    'case_size', entry.case_size,
    'liability', entry.liability,
    'minimum_value', entry.minimum_value,
    'estimated_fee_value', entry.estimated_fee_value,
    'case_description', entry.case_description,
    'last_quarterly_check_in_at', entry.last_quarterly_check_in_at,
    'last_reviewed_at', entry.last_reviewed_at,
    'policy_limits', entry.policy_limits,
    'policy_info_source', entry.policy_info_source,
    'source_of_estimate', entry.source_of_estimate,
    'sources', entry.sources,
    'referral_fee', entry.referral_fee,
    'referral_fee_arrangement', entry.referral_fee_arrangement,
    'balance_cta_info', entry.balance_cta_info,
    'injuries', entry.injuries,
    'lit_events_needed', entry.lit_events_needed,
    'lit_events_timeline', entry.lit_events_timeline,
    'status_notes', entry.status_notes,
    'gv_notes', entry.gv_notes,
    'lrj_notes', entry.lrj_notes,
    'forecast_notes', entry.forecast_notes,
    'attorney_notes', entry.attorney_notes,
    'manager_notes', entry.manager_notes,
    'is_active', entry.is_active,
    'case_number', entry.case_number,
    'client_name_snapshot', entry.client_name_snapshot,
    'attorney_contact_id', entry.attorney_contact_id,
    'paralegal_contact_id', entry.paralegal_contact_id,
    'attorney_name', entry.attorney_name,
    'paralegal_name', entry.paralegal_name,
    'unlinked_from_docketflow_at', entry.unlinked_from_docketflow_at
  )
$$;

create or replace function public.case_tracker_json_changed_fields(old_values jsonb, new_values jsonb)
returns text[]
language sql
stable
as $$
  select coalesce(array_agg(key order by key), '{}'::text[])
  from (
    select key
    from jsonb_object_keys(old_values || new_values) as keys(key)
    where old_values -> key is distinct from new_values -> key
  ) changed
$$;

create or replace function public.record_case_tracker_entry_version()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_values jsonb;
  v_new_values jsonb;
  v_changed_fields text[];
  v_version_number integer;
  v_change_reason text;
  v_change_source text;
  v_review_kind text;
begin
  if TG_OP <> 'UPDATE' then
    return NEW;
  end if;

  v_old_values := public.case_tracker_tracked_entry_json(OLD);
  v_new_values := public.case_tracker_tracked_entry_json(NEW);
  v_changed_fields := public.case_tracker_json_changed_fields(v_old_values, v_new_values);

  if array_length(v_changed_fields, 1) is null then
    return NEW;
  end if;

  select coalesce(max(version_number), 0) + 1
  into v_version_number
  from public.case_tracker_entry_versions
  where tracker_entry_id = NEW.id;

  v_change_reason := nullif(current_setting('case_tracker.change_reason', true), '');
  v_change_source := coalesce(nullif(current_setting('case_tracker.change_source', true), ''), 'manual');
  v_review_kind := nullif(current_setting('case_tracker.review_kind', true), '');

  insert into public.case_tracker_entry_versions (
    tracker_entry_id,
    case_id,
    case_number,
    version_number,
    changed_by,
    change_source,
    change_reason,
    review_kind,
    changed_fields,
    old_values,
    new_values
  )
  values (
    NEW.id,
    NEW.case_id,
    coalesce(NEW.case_number, OLD.case_number),
    v_version_number,
    coalesce(NEW.updated_by, auth.uid()),
    v_change_source,
    v_change_reason,
    v_review_kind,
    v_changed_fields,
    v_old_values,
    v_new_values
  );

  return NEW;
end;
$$;

drop trigger if exists trg_case_tracker_entry_versions on public.case_tracker_entries;
create trigger trg_case_tracker_entry_versions
after update on public.case_tracker_entries
for each row execute function public.record_case_tracker_entry_version();

-- Store app-level guidance that snapshots are freeze frames, while entry
-- versions are the queryable change history.

insert into public.case_tracker_settings (key, value, description)
values
  (
    'history_model',
    '{
      "current_state_table": "case_tracker_entries",
      "structured_history_table": "case_tracker_entry_versions",
      "quarterly_freeze_frame_table": "case_tracker_snapshots",
      "snapshots_drive_daily_app": false
    }'::jsonb,
    'Defines the living tracker model: current state plus structured history, with snapshots only for point-in-time leadership comparisons.'
  )
on conflict (key) do update
set
  value = excluded.value,
  description = excluded.description,
  updated_at = now();

grant select, insert, update, delete on public.case_tracker_entry_versions to authenticated;

commit;
