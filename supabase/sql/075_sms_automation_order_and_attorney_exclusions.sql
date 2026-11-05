-- Display order for the Client SMS page, and attorney scope as a skip list.
-- Empty excluded_attorney_contact_ids means the automation applies to every attorney.
-- Existing include-lists are converted to the attorneys who were left out, so behavior stays the same.

begin;

alter table public.sms_automations
  add column if not exists sort_order integer not null default 0,
  add column if not exists excluded_attorney_contact_ids uuid[] not null default '{}';

comment on column public.sms_automations.sort_order is
  'Client SMS page order only. Matching does not use this.';
comment on column public.sms_automations.excluded_attorney_contact_ids is
  'Cases assigned to these attorneys do not match. Empty = all attorneys.';
comment on column public.sms_automations.attorney_contact_ids is
  'Legacy include-list. Matching uses excluded_attorney_contact_ids. Cleared when the automation is saved.';

with ranked as (
  select id, (row_number() over (order by created_at desc) - 1) as rn
  from public.sms_automations
)
update public.sms_automations as automation
set sort_order = ranked.rn
from ranked
where automation.id = ranked.id
  and automation.sort_order = 0;

update public.sms_automations as automation
set excluded_attorney_contact_ids = coalesce((
  select array_agg(contact.id order by contact.name)
  from public.contacts as contact
  where contact.role = 'attorney'
    and not (contact.id = any(automation.attorney_contact_ids))
), '{}')
where cardinality(automation.attorney_contact_ids) > 0
  and cardinality(automation.excluded_attorney_contact_ids) = 0;

commit;
