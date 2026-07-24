-- Map DocketFlow contacts to Slack users for case topic summaries and reassignment.

begin;

alter table public.contacts
  add column if not exists slack_user_id text,
  add column if not exists slack_display_name text;

create unique index if not exists contacts_slack_user_id_unique
  on public.contacts (slack_user_id)
  where slack_user_id is not null;

comment on column public.contacts.slack_user_id is
  'Slack user id (U…) for topic mentions and topic→assignment sync.';

comment on column public.contacts.slack_display_name is
  'Slack display / handle used in channel topics (e.g. Ryan for @Ryan).';

commit;
