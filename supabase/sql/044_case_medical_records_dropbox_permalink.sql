-- Production medical capture inserts dropbox_permalink; 043 only had file id + path.

begin;

alter table public.case_medical_records
  add column if not exists dropbox_permalink text;

comment on column public.case_medical_records.dropbox_permalink is
  'Dropbox shared link for the source PDF. Use dropbox_file_id as the stable reference when available.';

commit;
