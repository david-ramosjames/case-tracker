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
  last_other_type: string | null;
  last_other_details: string | null;
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
  otherType?: string | null;
  otherDetails?: string | null;
};

export type ClientContactNoteInput = {
  caseNumber: string;
  caseId?: string | null;
  contactType: string;
  details?: string | null;
  loggedAt: string;
  slackChannelId?: string | null;
  slackTs?: string | null;
  eventKey: string;
  source: "slack" | "sheet";
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
    lastOtherType: row.last_other_type,
    lastOtherDetails: row.last_other_details,
  };
}

function otherMoment(at: string | null | undefined) {
  if (!at) return Number.NEGATIVE_INFINITY;
  const ms = Date.parse(at);
  return Number.isFinite(ms) ? ms : Number.NEGATIVE_INFINITY;
}

function mergedOther(current: ContactStamp, stamp: ContactStamp) {
  if (otherMoment(stamp.otherAt) >= otherMoment(current.otherAt)) {
    return {
      otherAt: stamp.otherAt ?? current.otherAt,
      otherType: stamp.otherType ?? current.otherType,
      otherDetails: stamp.otherDetails ?? current.otherDetails,
    };
  }
  return {
    otherAt: current.otherAt ?? stamp.otherAt,
    otherType: current.otherType ?? stamp.otherType,
    otherDetails: current.otherDetails ?? stamp.otherDetails,
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
      ...mergedOther(current, stamp),
    });
  }
  if (merged.size === 0) return { cases: 0 };

  const existing = await listClientContactSummaries([...merged.keys()]);
  const admin = requireAdmin();
  const now = new Date().toISOString();
  const rows = [...merged.values()].map((stamp) => {
    const previous = existing.get(stamp.caseNumber);
    const nextOtherAt = latestDate([previous?.lastOtherAt, stamp.otherAt]);
    const stampIsLatestOther = otherMoment(stamp.otherAt) >= otherMoment(previous?.lastOtherAt) && Boolean(stamp.otherAt);
    return {
      case_number: stamp.caseNumber,
      case_id: stamp.caseId ?? previous?.caseId ?? null,
      last_outbound_call_at: latestDate([previous?.lastOutboundCallAt, stamp.outboundCallAt]),
      last_human_call_at: latestDate([previous?.lastHumanCallAt, stamp.humanCallAt]),
      last_inbound_text_at: latestDate([previous?.lastInboundTextAt, stamp.inboundTextAt]),
      last_outbound_text_at: latestDate([previous?.lastOutboundTextAt, stamp.outboundTextAt]),
      last_conversation_at: latestDate([previous?.lastConversationAt, stamp.conversationAt]),
      last_other_at: nextOtherAt,
      last_other_type: stampIsLatestOther ? (stamp.otherType?.trim() || previous?.lastOtherType || null) : (previous?.lastOtherType ?? null),
      last_other_details: stampIsLatestOther ? (stamp.otherDetails?.trim() || previous?.lastOtherDetails || null) : (previous?.lastOtherDetails ?? null),
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

export type ClientSentimentReading = {
  caseNumber: string;
  sentiment: string;
  score: number | null;
  reasonSummary: string | null;
  weekLabel: string | null;
  scoredAt: string;
};

type SentimentRow = {
  case_number: string;
  sentiment: string;
  score: number | null;
  reason_summary: string | null;
  week_label: string | null;
  scored_at: string;
};

/** Latest stored reading per case. The page turns stale readings into Unknown. */
export async function listLatestClientSentiments(caseNumbers: string[]) {
  const readings = new Map<string, ClientSentimentReading>();
  const keys = [...new Set(caseNumbers.map((value) => cleanCaseNumber(value)).filter(Boolean))];
  if (keys.length === 0) return readings;

  const admin = requireAdmin();
  for (let index = 0; index < keys.length; index += 200) {
    const chunk = keys.slice(index, index + 200);
    const pending = new Set(chunk);
    let from = 0;
    while (pending.size > 0) {
      const { data, error } = await admin
        .from("case_client_sentiment")
        .select("case_number, sentiment, score, reason_summary, week_label, scored_at")
        .in("case_number", chunk)
        .order("scored_at", { ascending: false })
        .range(from, from + 999);
      if (error) throw new Error(error.message);
      const page = (data ?? []) as SentimentRow[];
      for (const row of page) {
        if (readings.has(row.case_number)) continue;
        readings.set(row.case_number, {
          caseNumber: row.case_number,
          sentiment: row.sentiment,
          score: row.score,
          reasonSummary: row.reason_summary,
          weekLabel: row.week_label,
          scoredAt: row.scored_at,
        });
        pending.delete(row.case_number);
      }
      if (page.length < 1000) break;
      from += page.length;
    }
  }
  return readings;
}

/** Stores one manual contact. Repeating the same Slack message does not create a second row. */
export async function insertClientContactNote(note: ClientContactNoteInput) {
  const caseNumber = cleanCaseNumber(note.caseNumber);
  const contactType = note.contactType.trim();
  if (!caseNumber || !contactType || !note.eventKey) return { inserted: false as const };

  const admin = requireAdmin();
  const { error } = await admin.from("case_client_contact_notes").upsert(
    {
      case_number: caseNumber,
      case_id: note.caseId ?? null,
      contact_type: contactType,
      details: note.details?.trim() || null,
      logged_at: note.loggedAt,
      slack_channel_id: note.slackChannelId ?? null,
      slack_ts: note.slackTs ?? null,
      event_key: note.eventKey,
      source: note.source,
    },
    { onConflict: "event_key", ignoreDuplicates: true },
  );
  if (error) throw new Error(error.message);
  return { inserted: true as const };
}
