-- Restore goals-import "To Be Completed This Week" rows that were moved out of
-- Committed. Keeps short lit document_label cleanup (notes stay in notes).
-- Safe to re-run.

begin;

-- Re-open commitments cancelled by the earlier "manual-only" fix.
update public.performance_commitments c
set
  outcome = 'promised',
  cancel_reason = null
from public.performance_deliverables d
where c.deliverable_id = d.id
  and c.outcome = 'cancelled'
  and c.cancel_reason = 'goals-import: committed is manual-entry only'
  and coalesce(d.notes, '') like '%[goals-import]%';

-- Put those deliverables back on Committed (and any still-committed import rows).
update public.performance_deliverables d
set
  workflow_status = 'committed',
  document_label = case
    when d.deliverable_type = 'lit_event_scheduled' and d.document_label ~* 'corp\s*rep' then 'Corp Rep'
    when d.deliverable_type = 'lit_event_scheduled' and d.document_label ~* 'expert' then 'Expert'
    when d.deliverable_type = 'lit_event_scheduled' and d.document_label ~* 'plaintiff' then 'Plaintiff'
    when d.deliverable_type = 'lit_event_scheduled'
      and d.document_label ~* 'defendant|d[''']?s\s*depo|d\s*depo|d\s*expert' then 'Defendant'
    when d.deliverable_type = 'lit_event_scheduled'
      and length(coalesce(d.document_label, '')) > 40 then null
    when d.deliverable_type = 'lit_event_scheduled'
      and coalesce(d.document_label, '') ~* '(sent|deadline|email)' then null
    else d.document_label
  end,
  updated_at = now()
where coalesce(d.notes, '') like '%[goals-import]%'
  and d.workflow_status in ('backlog', 'committed')
  and exists (
    select 1
    from public.performance_commitments c
    where c.deliverable_id = d.id
      and c.outcome = 'promised'
  );

commit;
