-- Expected litigation is no longer an attorney-facing Case Tracker field.
-- Stop treating open Slack reminders for it as pending.

update public.case_tracker_field_reminders
set dismissed_at = coalesce(dismissed_at, now())
where field_key = 'expectedLitigation'
  and confirmed_at is null
  and dismissed_at is null;
