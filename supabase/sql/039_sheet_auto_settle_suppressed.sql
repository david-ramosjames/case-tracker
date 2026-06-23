-- When a user manually moves a case off Settled, block settlement sheet sync from
-- auto-setting stage back to Settled until they explicitly set Settled again.

alter table public.case_tracker_entries
  add column if not exists sheet_auto_settle_suppressed boolean not null default false;

comment on column public.case_tracker_entries.sheet_auto_settle_suppressed is
  'Set when a user manually leaves Settled; cleared when stage is set to Settled. Blocks sheet auto-settle.';
