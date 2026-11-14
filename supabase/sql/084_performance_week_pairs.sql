-- Weekly pair seats + aggregate metric backfill — strictly additive.
-- Does NOT alter contacts, cases, or existing performance tables beyond new tables.

create table if not exists public.performance_week_pairs (
  id uuid primary key default gen_random_uuid(),
  week_start date not null,
  seat_index integer not null default 0,
  paralegal_contact_id uuid null,
  attorney_contact_id uuid null,
  paralegal_label text null,
  attorney_label text null,
  -- Both seats TBD: vacant roster slot, no work expected.
  is_vacant boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (week_start, seat_index)
);

comment on table public.performance_week_pairs is
  'Per-week attorney–paralegal seats for Team weekly check. One TBD is still a team; both TBD = vacant.';

create index if not exists idx_performance_week_pairs_week
  on public.performance_week_pairs (week_start);

create table if not exists public.performance_week_pair_metrics (
  id uuid primary key default gen_random_uuid(),
  week_pair_id uuid not null references public.performance_week_pairs(id) on delete cascade,
  metric_key text not null,
  actual_value numeric not null default 0,
  source text not null default 'import'
    check (source in ('import', 'manual', 'live')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (week_pair_id, metric_key)
);

comment on table public.performance_week_pair_metrics is
  'Aggregate weekly pair counts (backfill or manual). Live deliverable rollups fill gaps when no row exists.';

create index if not exists idx_performance_week_pair_metrics_pair
  on public.performance_week_pair_metrics (week_pair_id);

alter table public.performance_week_pairs enable row level security;
alter table public.performance_week_pair_metrics enable row level security;

drop policy if exists "performance_week_pairs_auth" on public.performance_week_pairs;
create policy "performance_week_pairs_auth" on public.performance_week_pairs
  for all to authenticated using (true) with check (true);

drop policy if exists "performance_week_pair_metrics_auth" on public.performance_week_pair_metrics;
create policy "performance_week_pair_metrics_auth" on public.performance_week_pair_metrics
  for all to authenticated using (true) with check (true);

grant select, insert, update, delete on public.performance_week_pairs to authenticated;
grant select, insert, update, delete on public.performance_week_pair_metrics to authenticated;
