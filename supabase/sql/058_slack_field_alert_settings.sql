insert into public.case_tracker_settings (key, value, description)
values
  (
    'slack_field_alerts',
    '{"grace_days": 7, "disabled_attorney_ids": []}'::jsonb,
    'Slack missing-field and field-reminder alert rules (grace period and per-attorney opt-out).'
  )
on conflict (key) do nothing;
