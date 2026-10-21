-- Latest client-contact dates per case, one column per interaction type.
-- Last interaction and last attempt are calculated in the app, matching the Contact Summary sheet.

create table if not exists public.case_client_contact_summary (
  case_number text primary key,
  case_id uuid,
  last_outbound_call_at timestamptz,
  last_human_call_at timestamptz,
  last_inbound_text_at timestamptz,
  last_outbound_text_at timestamptz,
  last_conversation_at timestamptz,
  last_other_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.case_client_contact_summary enable row level security;
revoke all on public.case_client_contact_summary from anon, authenticated;

notify pgrst, 'reload schema';
