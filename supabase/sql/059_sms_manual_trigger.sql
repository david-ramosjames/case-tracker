-- Manual SMS automations (e.g. attorney departure): queued on demand from Client SMS settings.

begin;

alter table public.sms_automations
  drop constraint if exists sms_automations_trigger_type_check;

alter table public.sms_automations
  add constraint sms_automations_trigger_type_check
  check (trigger_type in ('stage_change', 'time_in_stage', 'manual'));

comment on column public.sms_automations.trigger_type is
  'stage_change fires on tracker stage transition; time_in_stage is evaluated daily while case remains in in_stages; manual is queued on demand (e.g. attorney departure).';

commit;
