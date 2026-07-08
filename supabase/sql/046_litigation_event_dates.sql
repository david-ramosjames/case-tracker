begin;

-- Replace person text columns from the initial litigation-events migration with event dates.
alter table public.case_tracker_entries
  drop column if exists lit_plaintiff_dep_person,
  drop column if exists lit_defendant_dep_person,
  drop column if exists lit_mediation_person,
  drop column if exists lit_trial_person;

alter table public.case_tracker_entries
  add column if not exists lit_plaintiff_dep_date date,
  add column if not exists lit_defendant_dep_date date,
  add column if not exists lit_mediation_date date,
  add column if not exists lit_trial_date date;

comment on column public.case_tracker_entries.lit_plaintiff_dep_date is 'Plaintiff deposition date (litigation events).';
comment on column public.case_tracker_entries.lit_defendant_dep_date is 'Defendant deposition date (litigation events).';
comment on column public.case_tracker_entries.lit_mediation_date is 'Mediation date (litigation events).';
comment on column public.case_tracker_entries.lit_trial_date is 'Trial date (litigation events).';

create or replace function public.case_tracker_tracked_entry_json(entry public.case_tracker_entries)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'case_stage', entry.case_stage,
    'expected_litigation', entry.expected_litigation,
    'target_resolution_quarter', entry.target_resolution_quarter,
    'confidence_level', entry.confidence_level,
    'case_size', entry.case_size,
    'liability', entry.liability,
    'minimum_value', entry.minimum_value,
    'estimated_fee_value', entry.estimated_fee_value,
    'case_description', entry.case_description,
    'last_quarterly_check_in_at', entry.last_quarterly_check_in_at,
    'last_reviewed_at', entry.last_reviewed_at,
    'policy_limits', entry.policy_limits,
    'policy_info_source', entry.policy_info_source,
    'source_of_estimate', entry.source_of_estimate,
    'sources', entry.sources,
    'referral_fee', entry.referral_fee,
    'referral_fee_arrangement', entry.referral_fee_arrangement,
    'balance_cta_info', entry.balance_cta_info,
    'injuries', entry.injuries,
    'lit_events_needed', entry.lit_events_needed,
    'lit_events_timeline', entry.lit_events_timeline,
    'lit_plaintiff_dep_date', entry.lit_plaintiff_dep_date,
    'lit_plaintiff_dep_status', entry.lit_plaintiff_dep_status,
    'lit_defendant_dep_date', entry.lit_defendant_dep_date,
    'lit_defendant_dep_status', entry.lit_defendant_dep_status,
    'lit_mediation_date', entry.lit_mediation_date,
    'lit_mediation_status', entry.lit_mediation_status,
    'lit_trial_date', entry.lit_trial_date,
    'lit_trial_status', entry.lit_trial_status,
    'status_notes', entry.status_notes,
    'gv_notes', entry.gv_notes,
    'lrj_notes', entry.lrj_notes,
    'forecast_notes', entry.forecast_notes,
    'attorney_notes', entry.attorney_notes,
    'manager_notes', entry.manager_notes,
    'is_active', entry.is_active,
    'case_number', entry.case_number,
    'client_name_snapshot', entry.client_name_snapshot,
    'attorney_contact_id', entry.attorney_contact_id,
    'paralegal_contact_id', entry.paralegal_contact_id,
    'attorney_name', entry.attorney_name,
    'paralegal_name', entry.paralegal_name,
    'unlinked_from_docketflow_at', entry.unlinked_from_docketflow_at
  )
$$;

commit;
