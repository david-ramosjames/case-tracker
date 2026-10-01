-- AI Case Photo Evidence.
-- Dropbox is the source of truth for the original images; this table only holds metadata and the
-- one-time AI analysis. The file-sorter imports/analyzes photos (worker queue = rows in 'pending');
-- Case Tracker reads them, lets staff edit title/description/category, and re-queues failures.

create table if not exists public.evidence_photos (
  id uuid primary key default gen_random_uuid(),
  case_id uuid references public.cases(id) on delete set null,
  case_number text not null,

  dropbox_file_id text not null,
  dropbox_path text not null,
  dropbox_rev text,
  original_filename text not null,
  mime_type text,
  file_size bigint,
  dropbox_client_modified timestamptz,

  ai_title text,
  ai_description text,
  category text check (
    category is null or category in (
      'Vehicle Damage', 'Injury', 'Accident Scene', 'Property Damage', 'Medical', 'Document', 'Other'
    )
  ),
  ai_model text,
  analyzed_rev text,
  analyzed_at timestamptz,

  analysis_status text not null default 'pending'
    check (analysis_status in ('pending', 'processing', 'complete', 'failed')),
  analysis_error text,
  analysis_attempts integer not null default 0,
  processing_started_at timestamptz,

  human_edited boolean not null default false,
  edited_by text,
  edited_at timestamptz,

  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint evidence_photos_dropbox_file_id_key unique (dropbox_file_id)
);

comment on table public.evidence_photos is
  'Case photo metadata + one-time AI visual description. Originals live in Dropbox only (no image copies here).';
comment on column public.evidence_photos.analyzed_rev is
  'dropbox_rev that ai_* fields were generated from; re-analyze only when dropbox_rev differs.';
comment on column public.evidence_photos.human_edited is
  'True once staff edit title/description/category; sync/re-analysis must not overwrite those fields.';
comment on column public.evidence_photos.deleted_at is
  'Set when the file is deleted from Dropbox or moved out of the case folder; hidden from the app.';

create index if not exists evidence_photos_case_number_idx
  on public.evidence_photos (case_number) where deleted_at is null;
create index if not exists evidence_photos_case_id_idx
  on public.evidence_photos (case_id) where deleted_at is null;
create index if not exists evidence_photos_queue_idx
  on public.evidence_photos (created_at) where analysis_status = 'pending' and deleted_at is null;

create or replace function public.evidence_photos_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists evidence_photos_touch_updated_at on public.evidence_photos;
create trigger evidence_photos_touch_updated_at
  before update on public.evidence_photos
  for each row execute function public.evidence_photos_touch_updated_at();

-- Worker queue claim: atomically moves up to batch_size pending rows to 'processing'.
-- Also reclaims rows stuck in 'processing' for more than 15 minutes (crashed worker).
create or replace function public.claim_evidence_photos(batch_size integer default 5)
returns setof public.evidence_photos
language sql
set search_path = ''
as $$
  update public.evidence_photos p
     set analysis_status = 'processing',
         processing_started_at = now(),
         analysis_attempts = p.analysis_attempts + 1
   where p.id in (
     select q.id
       from public.evidence_photos q
      where q.deleted_at is null
        and (
          q.analysis_status = 'pending'
          or (q.analysis_status = 'processing' and q.processing_started_at < now() - interval '15 minutes')
        )
      order by q.created_at
      limit greatest(batch_size, 1)
      for update skip locked
   )
  returning p.*;
$$;

revoke all on function public.claim_evidence_photos(integer) from public, anon, authenticated;
grant execute on function public.claim_evidence_photos(integer) to service_role;

-- Server-side access only (service role). No anon/authenticated policies.
alter table public.evidence_photos enable row level security;
revoke all on public.evidence_photos from anon, authenticated;

notify pgrst, 'reload schema';
