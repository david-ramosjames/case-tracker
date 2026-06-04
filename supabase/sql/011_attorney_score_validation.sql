-- Per-field validation timestamps for attorney score (90-day freshness on key tracker fields)

alter table public.case_tracker_entries
  add column if not exists liability_validated_at timestamptz,
  add column if not exists target_resolution_quarter_validated_at timestamptz,
  add column if not exists minimum_value_validated_at timestamptz,
  add column if not exists policy_limits_validated_at timestamptz;

-- Seed from existing quarterly check-ins where possible
update public.case_tracker_entries
set
  liability_validated_at = coalesce(liability_validated_at, last_quarterly_check_in_at),
  target_resolution_quarter_validated_at = coalesce(target_resolution_quarter_validated_at, last_quarterly_check_in_at),
  minimum_value_validated_at = coalesce(minimum_value_validated_at, last_quarterly_check_in_at),
  policy_limits_validated_at = coalesce(policy_limits_validated_at, last_quarterly_check_in_at)
where last_quarterly_check_in_at is not null;
