-- Emergency reset: undo settlement financial CSV backfill imports.
-- Prefer Settings → Settlement financial backfill → "Reset all imports" (same logic via API).
--
-- Run this entire script in one go (select all → Run). Supabase runs one statement at a time;
-- a single DO block keeps temp tables in scope.

do $$
begin
  create temp table _reset_financial_backfill_targets on commit drop as
  select distinct
    e.id as tracker_entry_id,
    e.case_id,
    e.case_number,
    e.case_stage
  from public.case_tracker_entries e
  left join public.case_tracker_results r on r.tracker_entry_id = e.id
  where e.referral_fee_backfill_locked = true
     or coalesce(r.financial_backfill_locked, false) = true;

  delete from public.case_tracker_disbursements d
  using _reset_financial_backfill_targets t
  where d.case_number = t.case_number
    and d.sheet_row_key is null;

  update public.case_tracker_results r
  set
    financial_backfill_locked = false,
    settlement_date = null,
    settlement_amount = null,
    attorney_fees = null,
    fee_percent = null,
    disburse_date = null,
    check_disbursed_at = null,
    disbursed_status = 'No',
    check_status = 'No',
    result_quarter = null,
    release_status = 'No',
    closing_status = 'No',
    reductions_status = 'Not Complete'
  from _reset_financial_backfill_targets t
  where r.tracker_entry_id = t.tracker_entry_id
    and r.financial_backfill_locked = true;

  update public.case_tracker_entries e
  set
    referral_fee_backfill_locked = false,
    referral_fee = case when e.referral_fee_backfill_locked then null else e.referral_fee end,
    referral_fee_arrangement = case
      when e.referral_fee_arrangement like '%Financial backfill%' then null
      else e.referral_fee_arrangement
    end,
    case_stage = case
      when e.case_stage::text in ('Settlement', 'SETTLED') and ps.prior_stage is not null
        then ps.prior_stage::public.case_tracker_stage
      else e.case_stage
    end
  from _reset_financial_backfill_targets t
  left join lateral (
    select v.old_values->>'case_stage' as prior_stage
    from public.case_tracker_entry_versions v
    where v.tracker_entry_id = t.tracker_entry_id
      and coalesce(v.new_values->>'case_stage', '') in ('Settlement', 'Settled', 'SETTLED')
      and coalesce(v.old_values->>'case_stage', '') not in ('Settlement', 'Settled', 'SETTLED', '')
    order by v.changed_at desc
    limit 1
  ) ps on true
  where e.id = t.tracker_entry_id;
end $$;
