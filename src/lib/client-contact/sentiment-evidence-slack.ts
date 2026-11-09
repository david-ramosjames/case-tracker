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

async function loadCallDateLabels(callIds: string[]) {
  const dateByCallId = new Map<string, string>();
  const ids = [...new Set(callIds.map((id) => id.trim()).filter(Boolean))];
  if (!ids.length) return dateByCallId;

  const connectionString = process.env.REPORTING_DATABASE_URL?.trim();
  if (!connectionString) return dateByCallId;

  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  try {
    await client.connect();
    for (let index = 0; index < ids.length; index += 200) {
      const chunk = ids.slice(index, index + 200);
      const { rows } = await client.query<{ call_id: string; created_at: Date | string }>(
        `select call_id, created_at
         from quo_calls
         where call_id = any($1::text[])
           and created_at is not null`,
        [chunk],
      );
      for (const row of rows) {
        const callId = String(row.call_id ?? "").trim();
        if (!callId) continue;
        const iso =
          row.created_at instanceof Date
            ? row.created_at.toISOString()
            : String(row.created_at ?? "").trim();
        if (iso) dateByCallId.set(callId, iso);
      }
    }
  } catch (error) {
    console.error("[client-contact] call-date lookup for sentiment evidence failed", error);
  } finally {
    await client.end().catch(() => undefined);
  }
  return dateByCallId;
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
  const dateByCallId = await loadCallDateLabels(callIds);

  const phonesByCase = new Map<string, string[]>();
  for (const record of open) {
    const caseNumber = cleanCaseNumber(record.shared.caseNumber);
    const phones = new Set<string>();
    if (record.tracker.clientPhone) phones.add(record.tracker.clientPhone);
    for (const contact of record.tracker.quoContacts) {
      if (contact.phone) phones.add(contact.phone);
    }
    if (phones.size) phonesByCase.set(caseNumber, [...phones]);
  }

  const slackChannels = await loadSlackChannelMapByCaseNumber();
  const channelIdByCase = new Map<string, string>();
  for (const [caseNumber, channel] of slackChannels) {
    if (channel.slackChannelId) channelIdByCase.set(cleanCaseNumber(caseNumber), channel.slackChannelId);
  }

  const rows = readings.map((reading) => ({
    id: reading.id,
    caseNumber: reading.caseNumber,
    sentimentEvidence: applyEvidenceCallDateLabels(reading.evidenceItems, dateByCallId),
    sentimentWindowStart: reading.windowStart,
    sentimentWindowEnd: reading.windowEnd,
    sentimentScoredAt: reading.scoredAt,
    clientPhones: phonesByCase.get(cleanCaseNumber(reading.caseNumber)) ?? [],
  }));

  const enriched = await attachSentimentEvidenceSlackLinks(rows, channelIdByCase, {
    budgetMs: options?.budgetMs ?? 45_000,
    maxChannels: options?.maxChannels ?? 200,
  });

  const updates = enriched
    .map((row) => ({
      id: row.id,
      evidence: applyEvidenceCallDateLabels(row.sentimentEvidence, dateByCallId),
    }))
    .filter((row) => row.evidence.some((item) => item.dateLabel || !/openphone\.com/i.test(item.url)));

  const saved = updates.length ? await saveSentimentEvidenceResolved(updates) : { saved: 0 };
  return { pending: readings.length, resolved: updates.length, saved: saved.saved };
}
