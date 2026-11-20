-- One-shot: goals spreadsheet "To Be Completed This Week" was imported as
-- committed; Committed for this week should be manual entry only.
-- Also shortens lit_event document_label so titles don't append full notes.

begin;

-- Drop promised commitments for goals-import rows still marked committed.
update public.performance_commitments c
set
  outcome = 'cancelled',
  cancel_reason = 'goals-import: committed is manual-entry only'
from public.performance_deliverables d
where c.deliverable_id = d.id
  and c.outcome = 'promised'
  and d.workflow_status = 'committed'
  and coalesce(d.notes, '') like '%[goals-import]%';

-- Move those deliverables back to backlog (In progress).
update public.performance_deliverables d
set
  workflow_status = 'backlog',
  document_label = case
    when d.deliverable_type = 'lit_event_scheduled' and d.document_label ~* 'corp\s*rep' then 'Corp Rep'
    when d.deliverable_type = 'lit_event_scheduled' and d.document_label ~* 'expert' then 'Expert'
    when d.deliverable_type = 'lit_event_scheduled' and d.document_label ~* 'plaintiff' then 'Plaintiff'
    when d.deliverable_type = 'lit_event_scheduled'
      and d.document_label ~* 'defendant|d[''']?s\s*depo|d\s*depo|d\s*expert' then 'Defendant'
    when d.deliverable_type = 'lit_event_scheduled'
      and length(coalesce(d.document_label, '')) > 40 then null
    when d.deliverable_type = 'lit_event_scheduled'
      and d.document_label ~* '(sent|deadline|email)' then null
    else d.document_label
  end,
  updated_at = now()
where d.workflow_status = 'committed'
  and coalesce(d.notes, '') like '%[goals-import]%';

commit;
