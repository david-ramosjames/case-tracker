-- Google Auth provisioning notes
--
-- The app assigns roles on sign-in in /auth/callback:
-- - david@ramosjames.com -> admin
-- - jon@ramosjames.com   -> admin
-- - laura@ramosjames.com -> admin
-- - other @ramosjames.com users -> role from public.contacts (matched by email)
-- - no contact match -> no role row (user sees "Role pending" in the app)
--
-- Ensure contacts.email is populated for firm users who need tracker access.

begin;

comment on table public.case_tracker_user_roles is
  'Maps Supabase auth.users to tracker roles. Admins are provisioned by email; other users from contacts.email or manual admin assignment.';

commit;
