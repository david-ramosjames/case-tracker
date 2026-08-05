-- When a case becomes Closed (derived from stage + disbursement), stamp closed_at.
-- Cleared if the case reopens.

begin;

alter table public.case_tracker_entries
  add column if not exists closed_at timestamptz;

comment on column public.case_tracker_entries.closed_at is
  'When the case first became Closed in Case Tracker; cleared if it reopens.';

create index if not exists case_tracker_entries_closed_at_idx
  on public.case_tracker_entries (closed_at)
  where closed_at is not null;

commit;
