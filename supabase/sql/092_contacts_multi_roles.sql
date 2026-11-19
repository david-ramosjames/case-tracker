-- Multi-role contacts: roles[] is the shared source of truth for seat matching across
-- Case Tracker, DocketFlow, and paralegal-checklist. contacts.role remains the primary role
-- for login/display and backward-compatible readers.

alter table public.contacts
  add column if not exists roles text[] not null default '{}'::text[];

comment on column public.contacts.roles is
  'Staff capability roles (checkbox set). Includes primary contacts.role. Used for case seat matching.';

comment on column public.contacts.role is
  'Primary role for display / legacy readers. Must be one of contacts.roles.';

create or replace function public.contact_has_role(
  p_roles text[],
  p_primary text,
  p_want text
)
returns boolean
language sql
immutable
as $$
  select
    case
      when p_want is null or btrim(p_want) = '' then false
      when p_roles is not null and cardinality(p_roles) > 0 then p_want = any (p_roles)
      else p_primary = p_want
    end;
$$;

create or replace function public.contacts_normalize_roles()
returns trigger
language plpgsql
as $$
declare
  v_roles text[];
  v_primary text;
begin
  v_primary := nullif(btrim(coalesce(NEW.role, '')), '');
  v_roles := coalesce(
    (
      select array_agg(distinct r order by r)
      from unnest(coalesce(NEW.roles, '{}'::text[])) as u(r)
      where nullif(btrim(r), '') is not null
    ),
    '{}'::text[]
  );

  if cardinality(v_roles) = 0 and v_primary is not null then
    v_roles := array[v_primary];
  end if;

  if v_primary is null and cardinality(v_roles) > 0 then
    v_primary := v_roles[1];
  end if;

  if v_primary is not null and not (v_primary = any (v_roles)) then
    v_roles := array[v_primary] || v_roles;
  end if;

  NEW.role := v_primary;
  NEW.roles := coalesce(v_roles, '{}'::text[]);
  return NEW;
end;
$$;

drop trigger if exists trg_contacts_normalize_roles on public.contacts;
create trigger trg_contacts_normalize_roles
before insert or update of role, roles on public.contacts
for each row execute function public.contacts_normalize_roles();

-- Backfill from primary role.
update public.contacts
set roles = array[role]
where (roles is null or cardinality(roles) = 0)
  and role is not null
  and btrim(role) <> '';

-- Valeria Flores: paralegal + legal assistant.
update public.contacts
set
  role = 'legal_assistant',
  roles = array['legal_assistant', 'paralegal']
where id = 'e0d485fc-2186-4a2a-8886-2554667eac64';

-- DocketFlow → tracker sync: match seats by roles[] (fallback to primary role).
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
  where public.contact_has_role(contact.roles, contact.role, 'attorney')
  order by assigned.ord
  limit 1;

  select contact.id, contact.name
  into v_paralegal_id, v_paralegal_name
  from unnest(v_assigned_contact_ids) with ordinality as assigned(contact_id, ord)
  join public.contacts contact on contact.id = assigned.contact_id
  where public.contact_has_role(contact.roles, contact.role, 'paralegal')
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

notify pgrst, 'reload schema';
