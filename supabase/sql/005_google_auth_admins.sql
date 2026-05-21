-- Google Auth provisioning notes
--
-- The app assigns roles on first sign-in in /auth/callback:
-- - david@ramosjames.com -> admin
-- - jon@ramosjames.com   -> admin
-- - all other @ramosjames.com users -> attorney
--
-- Ensure case_tracker_user_roles exists (from 001_case_tracker_schema.sql).
-- No manual seed is required if users sign in through Google OAuth.

begin;

comment on table public.case_tracker_user_roles is
  'Maps Supabase auth.users to tracker roles. Provisioned automatically on Google sign-in.';

commit;
