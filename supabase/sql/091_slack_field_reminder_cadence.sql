-- Cadence for 90-day field-reminder Slack batches (not every day).
update public.case_tracker_settings
set
  value = coalesce(value, '{}'::jsonb)
    || jsonb_build_object(
      'field_reminder_frequency_days', 7,
      'field_reminder_next_allowed_on', '2026-11-25'
    ),
  description = 'Slack missing-field and field-reminder alert rules (grace, opt-out, reminder cadence).',
  updated_at = now()
where key = 'slack_field_alerts';

insert into public.case_tracker_settings (key, value, description)
select
  'slack_field_alerts',
  jsonb_build_object(
    'grace_days', 7,
    'disabled_attorney_ids', '[]'::jsonb,
    'field_reminder_frequency_days', 7,
    'field_reminder_next_allowed_on', '2026-11-25'
  ),
  'Slack missing-field and field-reminder alert rules (grace, opt-out, reminder cadence).'
where not exists (
  select 1 from public.case_tracker_settings where key = 'slack_field_alerts'
);
