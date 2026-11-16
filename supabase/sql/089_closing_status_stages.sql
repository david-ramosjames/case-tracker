-- Expand Closing workflow statuses.
-- Legacy → new:
--   No → Not Drafted
--   Drafted / Approved / Signed unchanged
--   (Sent to Client is new; no legacy equivalent)

update public.case_tracker_results
set closing_status = case
  when closing_status = 'Signed' or closing_signed_at is not null then 'Signed'
  when closing_status in ('Drafted', 'Approved', 'Sent to Client', 'Not Drafted') then closing_status
  when closing_status = 'No' then 'Not Drafted'
  else 'Not Drafted'
end
where closing_status in ('No', 'Drafted', 'Approved', 'Signed')
   or (
     closing_signed_at is not null
     and closing_status is distinct from 'Signed'
   );

alter table public.case_tracker_results
  alter column closing_status set default 'Not Drafted';
