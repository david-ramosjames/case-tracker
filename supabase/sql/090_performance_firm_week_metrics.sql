-- Firm-wide weekly totals from the RJL GOALS "Team" sheet.
-- Distinct from performance_week_pairs (Individual / seat rollups).

create table if not exists public.performance_firm_week_metrics (
  week_start date not null,
  metric_key text not null,
  actual_value numeric not null default 0,
  source text not null default 'import'
    check (source in ('import', 'manual', 'live')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (week_start, metric_key)
);

comment on table public.performance_firm_week_metrics is
  'Official firm weekly totals (Team sheet). Team → Weekly history prefers these over summing Individual seats.';

create index if not exists idx_performance_firm_week_metrics_week
  on public.performance_firm_week_metrics (week_start);

alter table public.performance_firm_week_metrics enable row level security;

drop policy if exists "performance_firm_week_metrics_auth" on public.performance_firm_week_metrics;
create policy "performance_firm_week_metrics_auth" on public.performance_firm_week_metrics
  for all to authenticated using (true) with check (true);

grant select, insert, update, delete on public.performance_firm_week_metrics to authenticated;
