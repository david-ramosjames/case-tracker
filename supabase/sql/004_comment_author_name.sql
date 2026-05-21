-- Store display name on comments until auth.users is wired for author_id.

begin;

alter table public.case_tracker_comments
  add column if not exists author_name text;

commit;
