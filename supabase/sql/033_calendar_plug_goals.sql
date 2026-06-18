-- One-time monthly targets for calendar-year reporting outside the commission period.
alter table public.attorney_goals
  add column if not exists calendar_plug_goals jsonb not null default '{}'::jsonb,
  add column if not exists calendar_plug_fee_goals jsonb not null default '{}'::jsonb;

comment on column public.attorney_goals.calendar_plug_goals is
  'Gross disbursement targets for calendar months not covered by this attorney''s commission period (e.g. Oct–Dec when the commission year ends in September).';

comment on column public.attorney_goals.calendar_plug_fee_goals is
  'RJL fee targets for calendar plug months — same keys as calendar_plug_goals.';
