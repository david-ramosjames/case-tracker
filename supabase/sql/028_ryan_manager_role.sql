  -- Demote ryan@ramosjames.com from admin to manager in the case tracker.
  -- Manager is a tracker-only role (case_tracker_user_roles). DocketFlow contacts
  -- only allow attorney/paralegal via contacts_role_check — do not update contacts.

  begin;

  insert into public.case_tracker_user_roles (user_id, role, active)
  select users.id, 'manager', true
  from auth.users users
  where lower(trim(users.email)) = 'ryan@ramosjames.com'
  on conflict (user_id) do update
  set role = excluded.role, active = excluded.active;

  commit;
