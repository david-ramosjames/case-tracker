-- Time-in-stage SMS can wait on how long the case has been in the current stage,
-- not only on time since signing. stage_entered_at is the start of that clock.

begin;

alter table public.case_tracker_entries
  add column if not exists stage_entered_at timestamptz;

alter table public.case_tracker_entries
  alter column stage_entered_at set default now();

comment on column public.case_tracker_entries.stage_entered_at is
  'When the case entered its current stage. Reset on stage change. Used by time-in-stage SMS.';

update public.case_tracker_entries as entry
set stage_entered_at = coalesce(
  (
    select max(version.changed_at)
    from public.case_tracker_entry_versions as version
    where version.tracker_entry_id = entry.id
      and 'case_stage' = any(version.changed_fields)
  ),
  entry.created_at
)
where entry.stage_entered_at is null;

alter table public.sms_automations
  add column if not exists delay_hours_in_stage integer,
  add column if not exists delay_days_in_stage integer;

comment on column public.sms_automations.delay_hours_in_stage is
  'For time_in_stage: minimum whole hours in the current stage. Hours take precedence over days.';
comment on column public.sms_automations.delay_days_in_stage is
  'For time_in_stage: minimum whole days in the current stage.';

commit;
