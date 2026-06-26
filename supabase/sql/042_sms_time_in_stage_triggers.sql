-- Time-in-stage SMS automations: fire while case stays in a stage after signing delay (daily cron).

begin;

alter table public.sms_automations
  add column if not exists trigger_type text not null default 'stage_change'
    check (trigger_type in ('stage_change', 'time_in_stage')),
  add column if not exists in_stages text[] not null default '{}',
  add column if not exists delay_hours_after_signing integer;

comment on column public.sms_automations.trigger_type is
  'stage_change fires on tracker stage transition; time_in_stage is evaluated daily while case remains in in_stages.';
comment on column public.sms_automations.in_stages is
  'For time_in_stage: case must currently be in one of these stages.';
comment on column public.sms_automations.delay_hours_after_signing is
  'For time_in_stage: minimum whole hours after date signed. Use instead of or with delay_days_after_signing.';

commit;
