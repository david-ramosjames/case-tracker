-- Drop preferred_language from tracker if an earlier draft of 035 added it.
-- Source of truth is public.cases.preferred_language (DocketFlow).

begin;

alter table public.case_tracker_entries
  drop constraint if exists case_tracker_entries_preferred_language_check;

alter table public.case_tracker_entries
  drop column if exists preferred_language;

commit;
