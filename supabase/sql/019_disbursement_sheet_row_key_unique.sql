-- PostgREST upsert(onConflict: sheet_row_key) requires a non-partial unique index.
-- Migration 013 used a partial index (WHERE sheet_row_key IS NOT NULL) which Postgres
-- ON CONFLICT via Supabase cannot target.

begin;

drop index if exists public.case_tracker_disbursements_sheet_row_key_unique;

create unique index case_tracker_disbursements_sheet_row_key_unique
  on public.case_tracker_disbursements(sheet_row_key);

commit;
