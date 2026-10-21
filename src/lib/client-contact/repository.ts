import { cleanCaseNumber } from "@/lib/csv/parse";
import { latestDate, type ClientContactSummary } from "@/lib/client-contact/types";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type SummaryRow = {
  case_number: string;
  case_id: string | null;
  last_outbound_call_at: string | null;
  last_human_call_at: string | null;
  last_inbound_text_at: string | null;
  last_outbound_text_at: string | null;
  last_conversation_at: string | null;
  last_other_at: string | null;
};

export type ContactStamp = {
  caseId?: string | null;
  caseNumber: string;
  outboundCallAt?: string | null;
  humanCallAt?: string | null;
  inboundTextAt?: string | null;
  outboundTextAt?: string | null;
  conversationAt?: string | null;
  otherAt?: string | null;
};

function requireAdmin() {
  const admin = createSupabaseAdminClient();
  if (!admin) throw new Error("Service role required for client contacts.");
  return admin;
}

function rowToSummary(row: SummaryRow): ClientContactSummary {
  return {
    caseNumber: row.case_number,
    caseId: row.case_id,
    lastOutboundCallAt: row.last_outbound_call_at,
    lastHumanCallAt: row.last_human_call_at,
    lastInboundTextAt: row.last_inbound_text_at,
    lastOutboundTextAt: row.last_outbound_text_at,
    lastConversationAt: row.last_conversation_at,
    lastOtherAt: row.last_other_at,
  };
}

export async function listClientContactSummaries(caseNumbers: string[]) {
  const summaries = new Map<string, ClientContactSummary>();
  const keys = [...new Set(caseNumbers.map((value) => cleanCaseNumber(value)).filter(Boolean))];
  if (keys.length === 0) return summaries;

  const admin = requireAdmin();
  for (let index = 0; index < keys.length; index += 200) {
    const chunk = keys.slice(index, index + 200);
    const { data, error } = await admin.from("case_client_contact_summary").select("*").in("case_number", chunk);
    if (error) throw new Error(error.message);
    for (const row of (data ?? []) as SummaryRow[]) summaries.set(row.case_number, rowToSummary(row));
  }
  return summaries;
}

/** Moves each date forward. An older event never replaces a newer one. */
export async function applyContactStamps(stamps: ContactStamp[]) {
  const merged = new Map<string, ContactStamp>();
  for (const stamp of stamps) {
    const caseNumber = cleanCaseNumber(stamp.caseNumber);
    if (!caseNumber) continue;
    const current = merged.get(caseNumber) ?? { caseNumber };
    merged.set(caseNumber, {
      caseNumber,
      caseId: stamp.caseId ?? current.caseId,
      outboundCallAt: latestDate([current.outboundCallAt, stamp.outboundCallAt]),
      humanCallAt: latestDate([current.humanCallAt, stamp.humanCallAt]),
      inboundTextAt: latestDate([current.inboundTextAt, stamp.inboundTextAt]),
      outboundTextAt: latestDate([current.outboundTextAt, stamp.outboundTextAt]),
      conversationAt: latestDate([current.conversationAt, stamp.conversationAt]),
      otherAt: latestDate([current.otherAt, stamp.otherAt]),
    });
  }
  if (merged.size === 0) return { cases: 0 };

  const existing = await listClientContactSummaries([...merged.keys()]);
  const admin = requireAdmin();
  const now = new Date().toISOString();
  const rows = [...merged.values()].map((stamp) => {
    const previous = existing.get(stamp.caseNumber);
    return {
      case_number: stamp.caseNumber,
      case_id: stamp.caseId ?? previous?.caseId ?? null,
      last_outbound_call_at: latestDate([previous?.lastOutboundCallAt, stamp.outboundCallAt]),
      last_human_call_at: latestDate([previous?.lastHumanCallAt, stamp.humanCallAt]),
      last_inbound_text_at: latestDate([previous?.lastInboundTextAt, stamp.inboundTextAt]),
      last_outbound_text_at: latestDate([previous?.lastOutboundTextAt, stamp.outboundTextAt]),
      last_conversation_at: latestDate([previous?.lastConversationAt, stamp.conversationAt]),
      last_other_at: latestDate([previous?.lastOtherAt, stamp.otherAt]),
      updated_at: now,
    };
  });

  for (let index = 0; index < rows.length; index += 200) {
    const { error } = await admin
      .from("case_client_contact_summary")
      .upsert(rows.slice(index, index + 200), { onConflict: "case_number" });
    if (error) throw new Error(error.message);
  }
  return { cases: rows.length };
}
