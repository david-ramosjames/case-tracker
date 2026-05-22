-- Cached Attorney | Paralegal portion of Slack channel topic (with <@USER> mentions).

begin;

alter table public.case_slack_channels
  add column if not exists slack_topic_prefix text;

comment on column public.case_slack_channels.slack_topic_prefix is
  'Everything before the status parentheses in the Slack channel topic; preserves <@USER> mentions.';

commit;
