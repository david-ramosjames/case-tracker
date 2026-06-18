-- Allow attorneys and paralegals to edit settlement workflow fields on the Results page.

begin;

drop policy if exists "results editable by managers and admins" on public.case_tracker_results;
drop policy if exists "results editable by firm roles" on public.case_tracker_results;

create policy "results editable by firm roles"
on public.case_tracker_results
for all
to authenticated
using (
  public.case_tracker_current_role() in ('attorney', 'paralegal', 'manager', 'admin', 'super_admin')
)
with check (
  public.case_tracker_current_role() in ('attorney', 'paralegal', 'manager', 'admin', 'super_admin')
);

commit;
