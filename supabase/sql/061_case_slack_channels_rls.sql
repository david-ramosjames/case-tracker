-- Lock down Slack channel mapping via the Data API (anon/authenticated).
-- Case Tracker server code uses the service_role key, which bypasses RLS.

begin;

alter table public.case_slack_channels enable row level security;

comment on table public.case_slack_channels is
  'Maps DocketFlow case numbers to Slack case channels (synced from Google Sheet or admin import). RLS on; no anon/authenticated policies — server service_role only.';

commit;
