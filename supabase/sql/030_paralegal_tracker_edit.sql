-- Allow paralegals to edit tracker entries from the case table and case detail views.

begin;

drop policy if exists "tracker entries editable by firm roles" on public.case_tracker_entries;
create policy "tracker entries editable by firm roles"
on public.case_tracker_entries
for all
to authenticated
using (
  public.case_tracker_current_role() in ('attorney', 'paralegal', 'manager', 'admin', 'super_admin')
)
with check (
  public.case_tracker_current_role() in ('attorney', 'paralegal', 'manager', 'admin', 'super_admin')
);

commit;
