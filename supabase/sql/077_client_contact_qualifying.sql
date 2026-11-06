-- Qualifying contact for the 30-day clock.
-- A call counts at 90 seconds or more and not Sona.
-- Texts count when an inbound and an outbound fall within 7 days.

alter table public.case_client_contact_summary
  add column if not exists last_qualifying_call_at timestamptz,
  add column if not exists last_text_exchange_at timestamptz;

notify pgrst, 'reload schema';
