-- Policy Coverage vs Policy Limits (additive).
-- Does not overwrite existing policy_limits amounts or invent verified statuses.

alter table public.case_tracker_entries
  add column if not exists policy_coverage text
    check (
      policy_coverage is null
      or policy_coverage in ('no_coverage', 'pending', 'coverage_exists', 'limits_confirmed')
    );

alter table public.case_tracker_entries
  add column if not exists policy_coverage_validated_at timestamptz;

alter table public.case_tracker_entries
  add column if not exists policy_coverage_validated_by uuid;

alter table public.case_tracker_entries
  add column if not exists policy_coverage_next_due_at date;

alter table public.case_tracker_entries
  add column if not exists policy_verification_notes text;

alter table public.case_tracker_entries
  add column if not exists policy_coverage_needs_classification boolean not null default false;

comment on column public.case_tracker_entries.policy_coverage is
  'No Coverage | Pending | Coverage Exists | Limits Confirmed. Null = not yet classified.';

comment on column public.case_tracker_entries.policy_coverage_needs_classification is
  'True when legacy policy_limits exist but coverage status was not safely inferred.';

-- Preserve amounts. Flag rows that already have a dollar amount for human classification.
-- Do not treat $30,000 as verified; do not invent Coverage Exists / Limits Confirmed.
update public.case_tracker_entries
set policy_coverage_needs_classification = true
where policy_limits is not null
  and policy_coverage is null
  and policy_coverage_needs_classification = false;

create index if not exists idx_case_tracker_entries_policy_coverage_due
  on public.case_tracker_entries (policy_coverage_next_due_at)
  where policy_coverage in ('pending', 'coverage_exists');

create index if not exists idx_case_tracker_entries_policy_needs_class
  on public.case_tracker_entries (policy_coverage_needs_classification)
  where policy_coverage_needs_classification = true;
