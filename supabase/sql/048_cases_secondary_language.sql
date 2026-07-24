-- Replace translator flag with optional secondary language (English/Spanish).

begin;

alter table public.cases
  drop column if exists needs_translator;

alter table public.cases
  add column if not exists secondary_language text
  check (secondary_language is null or secondary_language in ('English', 'Spanish'));

comment on column public.cases.preferred_language is
  'Client primary language (English or Spanish).';

comment on column public.cases.secondary_language is
  'Optional secondary language (English or Spanish).';

commit;
