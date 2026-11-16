-- Expand Check workflow statuses.
-- Legacy → new:
--   No → Not Issued
--   Sent → Mailed
--   Deposited → Deposited (also when check_deposited_at is set)

update public.case_tracker_results
set check_status = case
  when check_status = 'Deposited' or check_deposited_at is not null then 'Deposited'
  when check_status = 'Sent' then 'Mailed'
  when check_status in ('Not Issued', 'Issued', 'Mailed', 'Received') then check_status
  else 'Not Issued'
end
where check_status in ('No', 'Sent', 'Deposited')
   or (
     check_deposited_at is not null
     and check_status is distinct from 'Deposited'
   );

alter table public.case_tracker_results
  alter column check_status set default 'Not Issued';
