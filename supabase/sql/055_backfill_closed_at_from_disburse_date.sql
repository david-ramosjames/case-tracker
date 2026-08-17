-- Backfill closed_at for already-disbursed cases that predate closed_at tracking.
-- Uses disburse_date at 12:00 UTC as an approximate close timestamp.
-- Only fills NULLs; does not overwrite existing closed_at.

with ranked as (
  select
    e.id as tracker_id,
    r.disburse_date,
    row_number() over (
      partition by e.id
      order by
        case when r.tracker_entry_id = e.id then 0 else 1 end,
        r.disburse_date desc nulls last
    ) as rn
  from public.case_tracker_entries e
  join public.case_tracker_results r
    on r.tracker_entry_id = e.id
    or (e.case_id is not null and r.case_id = e.case_id)
  where e.closed_at is null
    and r.disburse_date is not null
    and coalesce(r.disbursed_status, 'No') = 'Yes'
),
picked as (
  select tracker_id, disburse_date
  from ranked
  where rn = 1
)
update public.case_tracker_entries e
set closed_at = (p.disburse_date::timestamp + time '12:00') at time zone 'UTC'
from picked p
where e.id = p.tracker_id;
