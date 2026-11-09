import {
  applyEvidenceCallDateLabels,
  attachSentimentEvidenceSlackLinks,
  callIdFromEvidenceUrl,
  evidenceNeedsSlackResolve,
  type SentimentEvidenceItem,
} from "@/lib/client-contact/evidence-slack";
import {
  listLatestClientSentiments,
  saveSentimentEvidenceResolved,
} from "@/lib/client-contact/repository";
import { cleanCaseNumber } from "@/lib/csv/parse";
import { caseRequiresOngoingUpdates } from "@/lib/case-status";
import { loadSlackChannelMapByCaseNumber } from "@/lib/slack/channels";
import { getCases } from "@/lib/supabase/services";
import { Client } from "pg";

function conversationIdFromUrl(url: string) {
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    return parts.includes("c") ? parts[parts.indexOf("c") + 1] || "" : "";
  } catch {
    return "";
  }
}

function isoFromDb(value: Date | string | null | undefined) {
  if (!value) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value).trim();
}

async function loadEvidenceActivityDates(input: { callIds: string[]; conversationIds: string[] }) {
  const dateByCallId = new Map<string, string>();
  const dateByConversationId = new Map<string, string>();
  const callIds = [...new Set(input.callIds.map((id) => id.trim()).filter(Boolean))];
  const conversationIds = [...new Set(input.conversationIds.map((id) => id.trim()).filter(Boolean))];
  if (!callIds.length && !conversationIds.length) {
    return { dateByCallId, dateByConversationId };
  }

  const connectionString = process.env.REPORTING_DATABASE_URL?.trim();
  if (!connectionString) return { dateByCallId, dateByConversationId };

  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  try {
    await client.connect();

    for (let index = 0; index < callIds.length; index += 200) {
      const chunk = callIds.slice(index, index + 200);
      try {
        const { rows } = await client.query<{ call_id: string; created_at: Date | string }>(
          `select call_id, created_at
           from quo_calls
           where call_id = any($1::text[])
             and created_at is not null`,
          [chunk],
        );
        for (const row of rows) {
          const callId = String(row.call_id ?? "").trim();
          const iso = isoFromDb(row.created_at);
          if (callId && iso) dateByCallId.set(callId, iso);
        }
      } catch (error) {
        console.error("[client-contact] evidence call-date lookup failed", error);
      }
    }

    // quo_messages has no conversation_id column — only quo_calls does.
    for (let index = 0; index < conversationIds.length; index += 200) {
      const chunk = conversationIds.slice(index, index + 200);
      try {
        const { rows } = await client.query<{ conversation_id: string; created_at: Date | string }>(
          `select conversation_id, max(created_at) as created_at
           from quo_calls
           where conversation_id = any($1::text[])
             and created_at is not null
           group by conversation_id`,
          [chunk],
        );
        for (const row of rows) {
          const conversationId = String(row.conversation_id ?? "").trim();
          const iso = isoFromDb(row.created_at);
          if (conversationId && iso) dateByConversationId.set(conversationId, iso);
        }
      } catch (error) {
        console.error("[client-contact] evidence conversation-date lookup failed", error);
      }
    }
  } catch (error) {
    console.error("[client-contact] evidence activity-date lookup failed", error);
  } finally {
    await client.end().catch(() => undefined);
  }
  return { dateByCallId, dateByConversationId };
}

function namesLooselyMatch(left: string, right: string) {
  const normalize = (value: string) =>
    value
      .toLowerCase()
      .replace(/\b(es|en|new)\b/g, " ")
      .replace(/\d+/g, " ")
      .replace(/[^a-z\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const a = normalize(left);
  const b = normalize(right);
  if (!a || !b) return false;
  if (a === b || a.includes(b) || b.includes(a)) return true;
  const aParts = a.split(" ").filter((part) => part.length > 1);
  const bParts = new Set(b.split(" ").filter((part) => part.length > 1));
  return aParts.filter((part) => bParts.has(part)).length >= 2;
}

/**
 * Resolve Sentiment V/SMS evidence to Quo-router Slack permalinks + dates,
 * then cache on case_client_sentiment.evidence_resolved.
 */
export async function resolveAndCacheSentimentEvidenceSlackLinks(options?: {
  budgetMs?: number;
  maxChannels?: number;
  caseNumbers?: string[];
}) {
  const open = (await getCases()).filter((record) => caseRequiresOngoingUpdates(record));
  const caseNumbers =
    options?.caseNumbers?.map(cleanCaseNumber).filter(Boolean) ??
    open.map((record) => cleanCaseNumber(record.shared.caseNumber)).filter(Boolean);

  const readings = [...(await listLatestClientSentiments(caseNumbers)).values()]
    .filter((reading) => evidenceNeedsSlackResolve(reading.evidenceItems))
    .sort((a, b) => {
      const severity = (value: string) =>
        value === "Negative" ? 0 : value === "Neutral" ? 1 : value === "Positive" ? 2 : 3;
      const bySentiment = severity(a.sentiment) - severity(b.sentiment);
      if (bySentiment !== 0) return bySentiment;
      return Date.parse(b.scoredAt) - Date.parse(a.scoredAt);
    });

  if (!readings.length) {
    return { pending: 0, resolved: 0, saved: 0 };
  }

  const callIds = readings.flatMap((reading) =>
    reading.evidenceItems.map((item) => callIdFromEvidenceUrl(item.quoUrl || item.url)).filter(Boolean),
  );
  const conversationIds = readings.flatMap((reading) =>
    reading.evidenceItems.map((item) => conversationIdFromUrl(item.quoUrl || item.url)).filter(Boolean),
  );
  const { dateByCallId, dateByConversationId } = await loadEvidenceActivityDates({
    callIds,
    conversationIds,
  });

  const openByCase = new Map(open.map((record) => [cleanCaseNumber(record.shared.caseNumber), record]));
  const phonesForReading = (caseNumber: string, clientName: string) => {
    const record = openByCase.get(cleanCaseNumber(caseNumber));
    if (!record) return [] as string[];
    const phones = new Set<string>();
    const matchingContacts = record.tracker.quoContacts.filter((contact) =>
      namesLooselyMatch(contact.displayName || "", clientName),
    );
    for (const contact of matchingContacts) {
      if (contact.phone) phones.add(contact.phone);
    }
    if (!phones.size && record.tracker.clientPhone) phones.add(record.tracker.clientPhone);
    if (!phones.size) {
      for (const contact of record.tracker.quoContacts) {
        if (contact.phone) phones.add(contact.phone);
      }
    }
    return [...phones];
  };

  const slackChannels = await loadSlackChannelMapByCaseNumber();
  const channelIdByCase = new Map<string, string>();
  for (const [caseNumber, channel] of slackChannels) {
    if (channel.slackChannelId) channelIdByCase.set(cleanCaseNumber(caseNumber), channel.slackChannelId);
  }

  const rows = readings.map((reading) => {
    const evidence = applyEvidenceCallDateLabels(
      reading.evidenceItems,
      dateByCallId,
      dateByConversationId,
    );
    const preferredIso =
      evidence
        .map((item) => {
          const href = item.quoUrl || item.url;
          const callId = callIdFromEvidenceUrl(href);
          const conversationId = conversationIdFromUrl(href);
          return (
            (callId ? dateByCallId.get(callId) : undefined) ||
            (conversationId ? dateByConversationId.get(conversationId) : undefined) ||
            null
          );
        })
        .find(Boolean) || reading.scoredAt;
    return {
      id: reading.id,
      caseNumber: reading.caseNumber,
      clientName: reading.clientName,
      sentimentEvidence: evidence,
      sentimentWindowStart: reading.windowStart,
      sentimentWindowEnd: reading.windowEnd,
      sentimentScoredAt: preferredIso,
      clientPhones: phonesForReading(reading.caseNumber, reading.clientName),
    };
  });

  const enriched = await attachSentimentEvidenceSlackLinks(rows, channelIdByCase, {
    budgetMs: options?.budgetMs ?? 30_000,
    maxChannels: options?.maxChannels ?? 100,
  });

  const updates = enriched
    .map((row) => ({
      id: row.id,
      evidence: applyEvidenceCallDateLabels(row.sentimentEvidence, dateByCallId, dateByConversationId),
    }))
    .filter((row) =>
      row.evidence.some((item) => item.dateLabel || !/openphone\.com|quo\.com/i.test(item.url)),
    );

  const saved = updates.length ? await saveSentimentEvidenceResolved(updates) : { saved: 0 };
  return { pending: readings.length, resolved: updates.length, saved: saved.saved };
}
