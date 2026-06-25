-- SMS automation filters: multiple from-stages, any-to with exclusions, signing delay, attorney scope.

begin;

alter table public.sms_automations
  add column if not exists from_stages text[] not null default '{}',
  add column if not exists excluded_to_stages text[] not null default '{}',
  add column if not exists delay_days_after_signing integer,
  add column if not exists attorney_contact_ids uuid[] not null default '{}';

comment on column public.sms_automations.from_stages is
  'When non-empty, stage change must originate from one of these stages. Empty uses legacy from_stage.';
comment on column public.sms_automations.excluded_to_stages is
  'When to_stage is any, destination stages in this list do not match.';
comment on column public.sms_automations.delay_days_after_signing is
  'Minimum whole days after date signed before the automation can fire. Null = no delay.';
comment on column public.sms_automations.attorney_contact_ids is
  'When non-empty, only cases assigned to these contact ids match. Empty = all attorneys.';

-- Allow destination "any" (same pattern as from_stage).
comment on column public.sms_automations.to_stage is
  'Destination stage, or any for any stage not listed in excluded_to_stages.';

commit;
