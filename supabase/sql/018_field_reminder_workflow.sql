-- Per-field Slack reminders with thread/reaction confirmation

begin;

alter table public.case_tracker_entries
  add column if not exists expected_litigation_validated_at timestamptz,
  add column if not exists has_ever_been_litigation boolean not null default false;

comment on column public.case_tracker_entries.expected_litigation_validated_at is
  'Last time expected litigation was confirmed by attorney (90-day review when not in litigation).';

comment on column public.case_tracker_entries.has_ever_been_litigation is
  'Set when case stage reaches Litigation; locks expected lit to Lit and skips further prompts.';

create table if not exists public.case_tracker_field_reminders (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null,
  tracker_entry_id uuid not null references public.case_tracker_entries(id) on delete cascade,
  field_key text not null,
  slack_thread_ts text,
  posted_at timestamptz,
  confirmed_at timestamptz,
  dismissed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint case_tracker_field_reminders_field_key_check check (
    field_key in ('liability', 'targetResolutionQuarter', 'minimumValue', 'policyLimits', 'expectedLitigation')
  )
);

create index if not exists idx_case_tracker_field_reminders_thread
  on public.case_tracker_field_reminders(slack_thread_ts)
  where slack_thread_ts is not null and confirmed_at is null and dismissed_at is null;

create unique index if not exists idx_case_tracker_field_reminders_open
  on public.case_tracker_field_reminders(case_id, field_key)
  where confirmed_at is null and dismissed_at is null;

commit;
