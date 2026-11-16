-- Expand Reductions workflow statuses.
-- Legacy → new:
--   Not Complete → Not Started
--   To Be Sent → Reductions Proposed
--   Sent / Sent, Not Approved → Reductions Sent
--   Approved → Reductions Approved

update public.case_tracker_results
set reductions_status = case reductions_status
  when 'Not Complete' then 'Not Started'
  when 'To Be Sent' then 'Reductions Proposed'
  when 'Sent, Not Approved' then 'Reductions Sent'
  when 'Sent' then 'Reductions Sent'
  when 'Approved' then 'Reductions Approved'
  when 'Deposited' then 'Not Started'
  when 'N/A' then 'Not Started'
  when '' then 'Not Started'
  else reductions_status
end
where reductions_status in (
  'Not Complete',
  'To Be Sent',
  'Sent, Not Approved',
  'Sent',
  'Approved',
  'Deposited',
  'N/A',
  ''
);

alter table public.case_tracker_results
  alter column reductions_status set default 'Not Started';
