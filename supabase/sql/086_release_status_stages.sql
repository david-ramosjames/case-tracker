-- Expand Release workflow statuses.
-- Open (not disbursed): No → Not Received, Signed → Signed by Client.
-- Disbursed: all → Returned.

update public.case_tracker_results
set release_status = case
  when disbursed_status = 'Yes' or check_disbursed_at is not null then 'Returned'
  when release_status = 'Signed' or release_signed_at is not null then 'Signed by Client'
  else 'Not Received'
end
where release_status in ('No', 'Signed')
   or (disbursed_status = 'Yes' or check_disbursed_at is not null)
      and release_status is distinct from 'Returned';

alter table public.case_tracker_results
  alter column release_status set default 'Not Received';
