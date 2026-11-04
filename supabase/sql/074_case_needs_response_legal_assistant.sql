-- Legal assistant on the morning Needs Response queue.
-- Same assignment rule as the case record: first assigned contact with role legal_assistant.

alter table public.case_needs_response
  add column if not exists legal_assistant_name text;

update public.case_needs_response n
set legal_assistant_name = la.name,
    updated_at = now()
from public.cases cs
join lateral (
  select ct.name
  from unnest(cs.assigned_contact_ids) with ordinality as assigned(id, ord)
  join public.contacts ct
    on ct.id = assigned.id
   and ct.role = 'legal_assistant'
  order by assigned.ord
  limit 1
) la on true
where regexp_replace(coalesce(n.case_number, ''), '\D', '', 'g')
    = regexp_replace(coalesce(cs.case_number, ''), '\D', '', 'g')
  and regexp_replace(coalesce(n.case_number, ''), '\D', '', 'g') <> ''
  and coalesce(n.legal_assistant_name, '') = '';

notify pgrst, 'reload schema';
