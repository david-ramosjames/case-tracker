-- Paralegal Manager role: sees all paralegal-assigned cases; same edit rights as paralegal.
-- Keep DocketFlow contacts.role as 'paralegal' so they remain assignable on cases.
-- App access role lives in case_tracker_user_roles (same pattern as manager).

begin;

do $$ begin
  alter type public.case_tracker_role add value 'paralegal_manager';
exception
  when duplicate_object then null;
end $$;

-- Tracker entry edits (case table / detail).
drop policy if exists "tracker entries editable by firm roles" on public.case_tracker_entries;
create policy "tracker entries editable by firm roles"
on public.case_tracker_entries
for all
to authenticated
using (
  public.case_tracker_current_role() in (
    'attorney', 'paralegal', 'paralegal_manager', 'manager', 'admin', 'super_admin'
  )
)
with check (
  public.case_tracker_current_role() in (
    'attorney', 'paralegal', 'paralegal_manager', 'manager', 'admin', 'super_admin'
  )
);

-- Results / settlement workflow edits.
drop policy if exists "results editable by firm roles" on public.case_tracker_results;
create policy "results editable by firm roles"
on public.case_tracker_results
for all
to authenticated
using (
  public.case_tracker_current_role() in (
    'attorney', 'paralegal', 'paralegal_manager', 'manager', 'admin', 'super_admin'
  )
)
with check (
  public.case_tracker_current_role() in (
    'attorney', 'paralegal', 'paralegal_manager', 'manager', 'admin', 'super_admin'
  )
);

-- Promote Lyliana (leave contacts.role as paralegal for case assignment).
insert into public.case_tracker_user_roles (user_id, role, active)
select users.id, 'paralegal_manager'::public.case_tracker_role, true
from auth.users users
where lower(trim(users.email)) = 'lyliana@ramosjames.com'
on conflict (user_id) do update
set role = excluded.role, active = excluded.active;

commit;
