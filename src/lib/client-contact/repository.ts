import { cleanCaseNumber } from "@/lib/csv/parse";
import {
  evidenceItemsFromStoredUrls,
  type SentimentEvidenceItem,
} from "@/lib/client-contact/evidence-slack";
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
  last_qualifying_call_at: string | null;
  last_text_exchange_at: string | null;
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
  qualifyingCallAt?: string | null;
  textExchangeAt?: string | null;
  /** Ledger recompute: write these dates even when they move backward, and clear one inside the lookback. */
  replaceQualifying?: boolean;
  lookbackStart?: string | null;
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

const QUALIFYING_RULE_KEY = "client_contact_qualifying_rule";

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
    lastQualifyingCallAt: row.last_qualifying_call_at,
    lastTextExchangeAt: row.last_text_exchange_at,
    lastOtherAt: row.last_other_at,
    lastOtherType: row.last_other_type,
    lastOtherDetails: row.last_other_details,
  };
}

function keptQualifyingDate(
  previous: string | null | undefined,
  computed: string | null | undefined,
  _lookbackStart: string | null | undefined,
  _replace: boolean,
) {
  // The Quo ledger can miss older calls (or store them without the client phone).
  // Never erase a qualifying date the Quo API / an earlier sync already proved.
  return latestDate([previous, computed]);
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

/** True after a ledger sync has stored 60-second calls and 7-day text exchanges. */
export async function isQualifyingContactRuleReady() {
  const admin = createSupabaseAdminClient();
  if (!admin) return false;
  const { data, error } = await admin.from("case_tracker_settings").select("value").eq("key", QUALIFYING_RULE_KEY).maybeSingle();
  if (error) return false;
  const value = data?.value;
  return Boolean(value && typeof value === "object" && "ready" in value && value.ready === true);
}

export async function markQualifyingContactRuleReady() {
  const admin = requireAdmin();
  const { error } = await admin.from("case_tracker_settings").upsert(
    {
      key: QUALIFYING_RULE_KEY,
      value: { ready: true, at: new Date().toISOString(), callSeconds: 60, ledgerFloor: "2026-07-01" },
      description: "30-day contact counts a 60-second human call or a 7-day inbound and outbound text exchange. Sona does not count. Ledger floor July 1, 2026.",
    },
    { onConflict: "key" },
  );
  if (error) throw new Error(error.message);
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
      qualifyingCallAt: stamp.replaceQualifying ? (stamp.qualifyingCallAt ?? null) : latestDate([current.qualifyingCallAt, stamp.qualifyingCallAt]),
      textExchangeAt: stamp.replaceQualifying ? (stamp.textExchangeAt ?? null) : latestDate([current.textExchangeAt, stamp.textExchangeAt]),
      replaceQualifying: Boolean(current.replaceQualifying || stamp.replaceQualifying),
      lookbackStart: stamp.lookbackStart ?? current.lookbackStart,
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
      last_qualifying_call_at: keptQualifyingDate(
        previous?.lastQualifyingCallAt,
        stamp.qualifyingCallAt,
        stamp.lookbackStart,
        Boolean(stamp.replaceQualifying),
      ),
      last_text_exchange_at: keptQualifyingDate(
        previous?.lastTextExchangeAt,
        stamp.textExchangeAt,
        stamp.lookbackStart,
        Boolean(stamp.replaceQualifying),
      ),
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
  /** Quo contact display name (same grain as the weekly reporter / sheet). */
  clientName: string;
  sentiment: string;
  score: number | null;
  reasonSummary: string | null;
  evidenceUrls: string[];
  /** Structured evidence with optional date labels from the weekly markdown. */
  evidenceItems: SentimentEvidenceItem[];
  weekLabel: string | null;
  windowStart: string | null;
  windowEnd: string | null;
  scoredAt: string;
};

type SentimentRow = {
  case_number: string;
  client_name: string | null;
  sentiment: string;
  score: number | null;
  reason_summary: string | null;
  evidence_urls: string | null;
  week_label: string | null;
  window_start: string | null;
  window_end: string | null;
  scored_at: string;
};

const SENTIMENT_SEVERITY: Record<string, number> = { Negative: 0, Neutral: 1, Positive: 2 };

function contactKeyForReading(row: Pick<SentimentRow, "client_name" | "case_number">) {
  const name = row.client_name?.trim();
  return name || row.case_number;
}

/** Latest stored reading per Quo contact (client_name), for the given case numbers. */
export async function listLatestClientSentiments(caseNumbers: string[]) {
  const byContact = new Map<string, ClientSentimentReading>();
  const keys = [...new Set(caseNumbers.map((value) => cleanCaseNumber(value)).filter(Boolean))];
  if (keys.length === 0) return byContact;

  const admin = requireAdmin();
  for (let index = 0; index < keys.length; index += 200) {
    const chunk = keys.slice(index, index + 200);
    let from = 0;
    for (;;) {
      const { data, error } = await admin
        .from("case_client_sentiment")
        .select(
          "case_number, client_name, sentiment, score, reason_summary, evidence_urls, week_label, window_start, window_end, scored_at",
        )
        .in("case_number", chunk)
        .order("scored_at", { ascending: false })
        .range(from, from + 999);
      if (error) throw new Error(error.message);
      const page = (data ?? []) as SentimentRow[];
      for (const row of page) {
        const contactKey = contactKeyForReading(row);
        if (byContact.has(contactKey)) continue;
        const evidenceItems = evidenceItemsFromStoredUrls(row.evidence_urls);
        byContact.set(contactKey, {
          caseNumber: row.case_number,
          clientName: contactKey,
          sentiment: row.sentiment,
          score: row.score,
          reasonSummary: row.reason_summary,
          evidenceUrls: evidenceItems.map((item) => item.url),
          evidenceItems,
          weekLabel: row.week_label,
          windowStart: row.window_start,
          windowEnd: row.window_end,
          scoredAt: row.scored_at,
        });
      }
      if (page.length < 1000) break;
      from += page.length;
    }
  }
  return byContact;
}

/**
 * One current reading per case: newest scored_at wins; if tied, prefer the more severe sentiment.
 * Used for Calls badges and the Sentiment attorney scoreboard (case counts, not Quo contact counts).
 */
export function worstSentimentByCaseNumber(readings: Iterable<ClientSentimentReading>) {
  const byCase = new Map<string, ClientSentimentReading>();
  for (const reading of readings) {
    const existing = byCase.get(reading.caseNumber);
    if (!existing) {
      byCase.set(reading.caseNumber, reading);
      continue;
    }
    const nextMs = Date.parse(reading.scoredAt);
    const existingMs = Date.parse(existing.scoredAt);
    if (Number.isFinite(nextMs) && Number.isFinite(existingMs) && nextMs !== existingMs) {
      if (nextMs > existingMs) byCase.set(reading.caseNumber, reading);
      continue;
    }
    const nextRank = SENTIMENT_SEVERITY[reading.sentiment] ?? 9;
    const existingRank = SENTIMENT_SEVERITY[existing.sentiment] ?? 9;
    if (nextRank < existingRank) byCase.set(reading.caseNumber, reading);
  }
  return byCase;
}

export function sentimentFlagKey(caseNumber: string, clientName: string) {
  return `${cleanCaseNumber(caseNumber)}\t${clientName.trim()}`;
}

/** Action-required flags keyed by case_number + Quo contact name. */
export async function listSentimentActionFlags(caseNumbers: string[]) {
  const flags = new Map<string, boolean>();
  const keys = [...new Set(caseNumbers.map((value) => cleanCaseNumber(value)).filter(Boolean))];
  if (keys.length === 0) return flags;

  const admin = requireAdmin();
  for (let index = 0; index < keys.length; index += 200) {
    const chunk = keys.slice(index, index + 200);
    const { data, error } = await admin
      .from("case_client_sentiment_flags")
      .select("case_number, client_name, action_required")
      .in("case_number", chunk)
      .eq("action_required", true);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      flags.set(sentimentFlagKey(row.case_number, row.client_name ?? ""), true);
    }
  }
  return flags;
}

export async function setSentimentActionRequired(input: {
  caseNumber: string;
  clientName: string;
  actionRequired: boolean;
  updatedBy?: string | null;
}) {
  const caseNumber = cleanCaseNumber(input.caseNumber);
  const clientName = input.clientName.trim();
  if (!caseNumber || !clientName) throw new Error("Case number and client name are required.");

  const admin = requireAdmin();
  const { error } = await admin.from("case_client_sentiment_flags").upsert(
    {
      case_number: caseNumber,
      client_name: clientName,
      action_required: input.actionRequired,
      updated_at: new Date().toISOString(),
      updated_by: input.updatedBy?.trim() || null,
    },
    { onConflict: "case_number,client_name" },
  );
  if (error) throw new Error(error.message);
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
