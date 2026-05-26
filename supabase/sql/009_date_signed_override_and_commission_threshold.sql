-- Ramos James Law Case Tracker
-- Add tracker-owned date signed overrides and per-attorney commission thresholds.
--
-- Purpose:
-- - Date signed from DocketFlow often reflects record creation time; allow the
--   tracker to override it without mutating DocketFlow data.
-- - Commission thresholds are per-attorney annual numbers; commissionable amount
--   is RJL fees above that threshold.

begin;

alter table public.case_tracker_entries
  add column if not exists date_signed_override timestamptz;

comment on column public.case_tracker_entries.date_signed_override is
  'Optional override for the displayed date signed. When set, the app uses this instead of cases.created_at.';

alter table public.attorney_goals
  add column if not exists commission_threshold numeric(14,2) not null default 0;

comment on column public.attorney_goals.commission_threshold is
  'Annual commission threshold for the attorney. Commissionable amount is RJL fees above this threshold.';

commit;

