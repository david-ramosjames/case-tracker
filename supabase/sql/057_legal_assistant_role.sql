-- Legal assistant app role: assigned-case visibility (app layer) + same tracker/results edits as paralegal.
-- Source of assignment is DocketFlow cases.assigned_contact_ids (typically 3rd contact).
-- Do not wrap this file in a single transaction: the new enum value cannot be used until committed.

do $$ begin
  alter type public.case_tracker_role add value 'legal_assistant';
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
    'attorney', 'paralegal', 'paralegal_manager', 'legal_assistant', 'manager', 'admin', 'super_admin'
  )
)
with check (
  public.case_tracker_current_role() in (
    'attorney', 'paralegal', 'paralegal_manager', 'legal_assistant', 'manager', 'admin', 'super_admin'
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
    'attorney', 'paralegal', 'paralegal_manager', 'legal_assistant', 'manager', 'admin', 'super_admin'
  )
)
with check (
  public.case_tracker_current_role() in (
    'attorney', 'paralegal', 'paralegal_manager', 'legal_assistant', 'manager', 'admin', 'super_admin'
  )
);
