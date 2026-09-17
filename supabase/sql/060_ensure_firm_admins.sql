-- Ensure firm admin Google accounts always have an active admin tracker role.
-- App also hard-codes these emails as admin on every sign-in / page load.
insert into public.case_tracker_user_roles (user_id, role, active)
select u.id, 'admin'::public.case_tracker_role, true
from auth.users u
where lower(u.email) in (
  'david@ramosjames.com',
  'jon@ramosjames.com',
  'laura@ramosjames.com'
)
on conflict (user_id) do update
set
  role = excluded.role,
  active = true,
  updated_at = now();
