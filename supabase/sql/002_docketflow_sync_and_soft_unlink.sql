-- Ramos James Law Case Tracker
-- DocketFlow sync + survivable tracker rows.
--
-- Run after 001_case_tracker_schema.sql.
--
-- Purpose:
-- 1. New DocketFlow cases automatically create/update tracker rows.
-- 2. Tracker rows keep case number / client / attorney / paralegal snapshots.
-- 3. If a DocketFlow case is deleted, tracker rows remain and case_id becomes null.

begin;

-- Snapshot the key DocketFlow fields needed by the tracker after unlink.

alter table public.case_tracker_entries
  add column if not exists case_number text,
  add column if not exists client_name_snapshot text,
  add column if not exists attorney_contact_id uuid references public.contacts(id) on delete set null,
  add column if not exists paralegal_contact_id uuid references public.contacts(id) on delete set null,
  add column if not exists attorney_name text,
  add column if not exists paralegal_name text,
  add column if not exists unlinked_from_docketflow_at timestamptz;

create index if not exists idx_case_tracker_entries_case_number
on public.case_tracker_entries(case_number);

create index if not exists idx_case_tracker_entries_attorney_contact
on public.case_tracker_entries(attorney_contact_id);

create index if not exists idx_case_tracker_entries_paralegal_contact
on public.case_tracker_entries(paralegal_contact_id);

-- Make case_id nullable and replace ON DELETE CASCADE with ON DELETE SET NULL.
-- This lets DocketFlow deletes succeed while preserving tracker history.

alter table public.case_tracker_entries
  drop constraint if exists case_tracker_entries_case_id_fkey;

alter table public.case_tracker_entries
  alter column case_id drop not null;

alter table public.case_tracker_entries
  add constraint case_tracker_entries_case_id_fkey
  foreign key (case_id) references public.cases(id) on delete set null;

alter table public.case_tracker_results
  drop constraint if exists case_tracker_results_case_id_fkey;

alter table public.case_tracker_results
  alter column case_id drop not null;

alter table public.case_tracker_results
  add constraint case_tracker_results_case_id_fkey
  foreign key (case_id) references public.cases(id) on delete set null;

alter table public.case_tracker_comments
  drop constraint if exists case_tracker_comments_case_id_fkey;

alter table public.case_tracker_comments
  alter column case_id drop not null;

alter table public.case_tracker_comments
  add constraint case_tracker_comments_case_id_fkey
  foreign key (case_id) references public.cases(id) on delete set null;

alter table public.case_tracker_activity
  drop constraint if exists case_tracker_activity_case_id_fkey;

alter table public.case_tracker_activity
  alter column case_id drop not null;

alter table public.case_tracker_activity
  add constraint case_tracker_activity_case_id_fkey
  foreign key (case_id) references public.cases(id) on delete set null;

alter table public.case_tracker_stage_suggestions
  drop constraint if exists case_tracker_stage_suggestions_case_id_fkey;

alter table public.case_tracker_stage_suggestions
  alter column case_id drop not null;

alter table public.case_tracker_stage_suggestions
  add constraint case_tracker_stage_suggestions_case_id_fkey
  foreign key (case_id) references public.cases(id) on delete set null;

-- Replace unique(case_id) constraints with partial unique indexes.
-- Postgres allows many nulls in a unique constraint, but a partial unique index
-- is clearer and avoids future confusion.

alter table public.case_tracker_entries
  drop constraint if exists case_tracker_entries_case_id_key;

drop index if exists public.case_tracker_entries_case_id_unique;
create unique index case_tracker_entries_case_id_unique
on public.case_tracker_entries(case_id)
where case_id is not null;

alter table public.case_tracker_results
  drop constraint if exists case_tracker_results_case_id_key;

drop index if exists public.case_tracker_results_case_id_unique;
create unique index case_tracker_results_case_id_unique
on public.case_tracker_results(case_id)
where case_id is not null;

-- Fill snapshots for any existing linked tracker rows before relying on them.

update public.case_tracker_entries e
set
  case_number = coalesce(e.case_number, c.case_number),
  client_name_snapshot = coalesce(e.client_name_snapshot, c.client_name)
from public.cases c
where e.case_id = c.id
  and (e.case_number is null or e.client_name_snapshot is null);

update public.case_tracker_entries e
set
  attorney_contact_id = coalesce(e.attorney_contact_id, attorney.id),
  attorney_name = coalesce(e.attorney_name, attorney.name),
  paralegal_contact_id = coalesce(e.paralegal_contact_id, paralegal.id),
  paralegal_name = coalesce(e.paralegal_name, paralegal.name)
from public.cases c
left join lateral (
  select contact.id, contact.name
  from unnest(coalesce(c.assigned_contact_ids, '{}'::uuid[])) with ordinality as assigned(contact_id, ord)
  join public.contacts contact on contact.id = assigned.contact_id
  where contact.role = 'attorney'
  order by assigned.ord
  limit 1
) attorney on true
left join lateral (
  select contact.id, contact.name
  from unnest(coalesce(c.assigned_contact_ids, '{}'::uuid[])) with ordinality as assigned(contact_id, ord)
  join public.contacts contact on contact.id = assigned.contact_id
  where contact.role = 'paralegal'
  order by assigned.ord
  limit 1
) paralegal on true
where e.case_id = c.id
  and (
    e.attorney_contact_id is null
    or e.attorney_name is null
    or e.paralegal_contact_id is null
    or e.paralegal_name is null
  );

-- Sync DocketFlow cases into tracker rows.
--
-- Assumes:
-- - public.cases.case_number
-- - public.cases.client_name
-- - public.cases.assigned_contact_ids uuid[]
-- - public.contacts.id/name/role where role is 'attorney' or 'paralegal'

create or replace function public.sync_case_tracker_from_docketflow_case()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_case_id uuid;
  v_case_number text;
  v_client_name text;
  v_assigned_contact_ids uuid[];
  v_attorney_id uuid;
  v_paralegal_id uuid;
  v_attorney_name text;
  v_paralegal_name text;
begin
  if TG_OP = 'DELETE' then
    v_case_id := OLD.id;
    v_case_number := OLD.case_number;
    v_client_name := OLD.client_name;
    v_assigned_contact_ids := coalesce(OLD.assigned_contact_ids, '{}'::uuid[]);
  else
    v_case_id := NEW.id;
    v_case_number := NEW.case_number;
    v_client_name := NEW.client_name;
    v_assigned_contact_ids := coalesce(NEW.assigned_contact_ids, '{}'::uuid[]);
  end if;

  select contact.id, contact.name
  into v_attorney_id, v_attorney_name
  from unnest(v_assigned_contact_ids) with ordinality as assigned(contact_id, ord)
  join public.contacts contact on contact.id = assigned.contact_id
  where contact.role = 'attorney'
  order by assigned.ord
  limit 1;

  select contact.id, contact.name
  into v_paralegal_id, v_paralegal_name
  from unnest(v_assigned_contact_ids) with ordinality as assigned(contact_id, ord)
  join public.contacts contact on contact.id = assigned.contact_id
  where contact.role = 'paralegal'
  order by assigned.ord
  limit 1;

  if TG_OP = 'DELETE' then
    update public.case_tracker_entries
    set
      case_number = coalesce(case_number, v_case_number),
      client_name_snapshot = coalesce(client_name_snapshot, v_client_name),
      attorney_contact_id = coalesce(attorney_contact_id, v_attorney_id),
      paralegal_contact_id = coalesce(paralegal_contact_id, v_paralegal_id),
      attorney_name = coalesce(attorney_name, v_attorney_name),
      paralegal_name = coalesce(paralegal_name, v_paralegal_name),
      unlinked_from_docketflow_at = coalesce(unlinked_from_docketflow_at, now()),
      updated_at = now()
    where case_id = v_case_id;

    return OLD;
  end if;

  insert into public.case_tracker_entries (
    case_id,
    case_number,
    client_name_snapshot,
    attorney_contact_id,
    paralegal_contact_id,
    attorney_name,
    paralegal_name
  )
  values (
    v_case_id,
    v_case_number,
    v_client_name,
    v_attorney_id,
    v_paralegal_id,
    v_attorney_name,
    v_paralegal_name
  )
  on conflict (case_id) where case_id is not null
  do update set
    case_number = excluded.case_number,
    client_name_snapshot = excluded.client_name_snapshot,
    attorney_contact_id = excluded.attorney_contact_id,
    paralegal_contact_id = excluded.paralegal_contact_id,
    attorney_name = excluded.attorney_name,
    paralegal_name = excluded.paralegal_name,
    unlinked_from_docketflow_at = null,
    updated_at = now();

  return NEW;
end;
$$;

drop trigger if exists trg_cases_sync_case_tracker_insert on public.cases;
create trigger trg_cases_sync_case_tracker_insert
after insert on public.cases
for each row execute function public.sync_case_tracker_from_docketflow_case();

drop trigger if exists trg_cases_sync_case_tracker_update on public.cases;
create trigger trg_cases_sync_case_tracker_update
after update of case_number, client_name, assigned_contact_ids on public.cases
for each row execute function public.sync_case_tracker_from_docketflow_case();

drop trigger if exists trg_cases_sync_case_tracker_delete on public.cases;
create trigger trg_cases_sync_case_tracker_delete
before delete on public.cases
for each row execute function public.sync_case_tracker_from_docketflow_case();

-- Recreate the app view so it prefers live DocketFlow data when available,
-- then falls back to tracker snapshots when a DocketFlow case was deleted.

drop view if exists public.case_tracker_case_view;

create view public.case_tracker_case_view as
select
  coalesce(c.id, e.case_id) as case_id,
  e.id as tracker_entry_id,
  coalesce(c.case_number, e.case_number) as case_number,
  coalesce(c.client_name, e.client_name_snapshot) as client_name,
  c.status as shared_status,
  c.case_type,
  c.date_of_incident,
  c.created_at as case_created_at,
  c.updated_at as case_updated_at,
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
  e.case_number as case_number_snapshot,
  e.client_name_snapshot,
  e.attorney_contact_id,
  e.paralegal_contact_id,
  e.attorney_name,
  e.paralegal_name,
  e.unlinked_from_docketflow_at,
  (e.case_id is null or e.unlinked_from_docketflow_at is not null) as removed_from_docketflow,
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
from public.case_tracker_entries e
left join public.cases c on c.id = e.case_id
left join public.case_tracker_results r on r.tracker_entry_id = e.id
  or (r.case_id is not null and r.case_id = e.case_id);

alter view public.case_tracker_case_view set (security_invoker = true);

grant select on public.case_tracker_case_view to authenticated;

commit;
