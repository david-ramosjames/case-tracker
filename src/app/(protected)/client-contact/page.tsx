import { Suspense } from "react";
import { ClientContactView, type ClientContactRow } from "@/components/client-contact/client-contact-table";
import { buildViewerContext, canViewAllNeedsResponse } from "@/lib/auth/access";
import {
  isQualifyingContactRuleReady,
  listClientContactSummaries,
  listLatestClientSentiments,
  listSentimentActionFlags,
  sentimentFlagKey,
  worstSentimentByCaseNumber,
} from "@/lib/client-contact/repository";
import { attachSentimentEvidenceSlackLinks } from "@/lib/client-contact/evidence-slack";
import { clientContactDates, type ClientContactSummary } from "@/lib/client-contact/types";
import { caseRequiresOngoingUpdates } from "@/lib/case-status";
import { cleanCaseNumber } from "@/lib/csv/parse";
import { loadViewerCaseBundle } from "@/lib/data/viewer-data";
import { getQuoClientSmsUrl, getQuoContactUrl, getQuoConversationUrl } from "@/lib/quo/links";
import { loadSlackChannelMapByCaseNumber } from "@/lib/slack/channels";
import { type CaseRecord } from "@/lib/types";

export const dynamic = "force-dynamic";

function isAssignedToViewer(record: CaseRecord, contactId: string) {
  return (
    record.shared.attorneyId === contactId ||
    record.shared.paralegalId === contactId ||
    record.shared.legalAssistantId === contactId
  );
}

/** Referred-out cases are stored under the placeholder attorney/paralegal named Referred. */
function isReferredAssignment(name: string | null | undefined) {
  return /^\s*referred\b/i.test(name ?? "");
}

function isReferredCase(record: CaseRecord, topicStage: string | null | undefined) {
  if (record.tracker.caseStage === "Referred") return true;
  if (topicStage && /\breferred\b/i.test(topicStage)) return true;
  return (
    isReferredAssignment(record.attorney.name) ||
    isReferredAssignment(record.paralegal.name) ||
    isReferredAssignment(record.legalAssistant?.name)
  );
}

function quoUrlForCase(record: CaseRecord, stored?: ClientContactSummary | null) {
  // Prefer the line that actually owns the latest qualifying call — never invent RJL Main Line.
  const fromQualifying = getQuoConversationUrl({
    quoConversationId: stored?.lastQualifyingCallConversationId,
    quoPhoneNumberId: stored?.lastQualifyingCallPhoneNumberId,
  });
  if (fromQualifying) return fromQualifying;

  const candidates = [
    {
      quoConversationId: record.tracker.quoConversationId,
      quoPhoneNumberId: record.tracker.quoPhoneNumberId,
    },
    ...record.tracker.quoContacts.map((contact) => ({
      quoConversationId: contact.quoConversationId,
      quoPhoneNumberId: contact.quoPhoneNumberId,
    })),
  ];
  for (const candidate of candidates) {
    const inboxUrl = getQuoClientSmsUrl(candidate);
    if (inboxUrl) return inboxUrl;
  }
  return (
    getQuoContactUrl(record.tracker.quoContactId) ??
    record.tracker.quoContacts.map((contact) => getQuoContactUrl(contact.quoContactId)).find((url) => url) ??
    null
  );
}

function phonesForCase(record: CaseRecord) {
  const phones = new Set<string>();
  if (record.tracker.clientPhone) phones.add(record.tracker.clientPhone);
  for (const contact of record.tracker.quoContacts) {
    if (contact.phone) phones.add(contact.phone);
  }
  return [...phones];
}

export default async function ClientContactPage() {
  const [{ records, allRecords, sessionUser, users, settings }, slackChannels] = await Promise.all([
    loadViewerCaseBundle(),
    loadSlackChannelMapByCaseNumber(),
  ]);
  const viewer = buildViewerContext(sessionUser, users);
  // Admins, the managing attorney, and the paralegal manager see the full open queue.
  const seesEveryone = canViewAllNeedsResponse(viewer);
  const visibleCases = seesEveryone ? allRecords : records;
  const open = visibleCases.filter((record) => {
    const topicStage = slackChannels.get(cleanCaseNumber(record.shared.caseNumber))?.topicStage;
    if (isReferredCase(record, topicStage)) return false;
    if (!caseRequiresOngoingUpdates(record)) return false;
    if (seesEveryone) return true;
    return viewer.contactId ? isAssignedToViewer(record, viewer.contactId) : false;
  });
  const caseNumbers = open.map((record) => record.shared.caseNumber);
  const [summary, sentimentsByContact, actionFlags, qualifyingRule] = await Promise.all([
    listClientContactSummaries(caseNumbers),
    listLatestClientSentiments(caseNumbers),
    listSentimentActionFlags(caseNumbers),
    isQualifyingContactRuleReady(),
  ]);
  const sentimentsByCase = worstSentimentByCaseNumber(sentimentsByContact.values());
  const openByCaseNumber = new Map(open.map((record) => [cleanCaseNumber(record.shared.caseNumber), record]));

  function isActionRequired(caseNumber: string, clientName: string) {
    return actionFlags.has(sentimentFlagKey(caseNumber, clientName));
  }

  const rows = open.map((record) => {
    const caseNumber = cleanCaseNumber(record.shared.caseNumber);
    const dates = clientContactDates(summary.get(caseNumber) ?? null, { qualifying: qualifyingRule });
    const stored = summary.get(caseNumber);
    const sentiment = sentimentsByCase.get(caseNumber);
    return {
      caseId: record.shared.id,
      caseNumber: record.shared.caseNumber,
      attorneyId: record.attorney.id,
      clientName: record.shared.clientName,
      attorneyName: record.attorney.name,
      paralegalName: record.paralegal.name,
      legalAssistantName: record.legalAssistant?.name ?? "",
      lastInteraction: dates.lastInteraction,
      lastAttempt: dates.lastAttempt,
      lastQualifyingCall: stored?.lastQualifyingCallAt ?? null,
      lastQualifyingCallId: stored?.lastQualifyingCallId ?? null,
      lastQualifyingCallSlackUrl: stored?.lastQualifyingCallSlackUrl ?? null,
      lastInboundText: stored?.lastInboundTextAt ?? null,
      lastOutboundText: stored?.lastOutboundTextAt ?? null,
      lastTextExchange: stored?.lastTextExchangeAt ?? null,
      lastOutboundCall: stored?.lastOutboundCallAt ?? null,
      lastOtherAt: stored?.lastOtherAt ?? null,
      lastOtherType: stored?.lastOtherType ?? null,
      lastOtherDetails: stored?.lastOtherDetails ?? null,
      sentiment: sentiment?.sentiment ?? null,
      sentimentScore: sentiment?.score ?? null,
      sentimentReason: sentiment?.reasonSummary ?? null,
      sentimentEvidenceUrls: sentiment?.evidenceUrls ?? [],
      sentimentEvidence: sentiment?.evidenceItems ?? [],
      sentimentWeekLabel: sentiment?.weekLabel ?? null,
      sentimentWindowStart: sentiment?.windowStart ?? null,
      sentimentWindowEnd: sentiment?.windowEnd ?? null,
      sentimentScoredAt: sentiment?.scoredAt ?? null,
      clientPhones: phonesForCase(record),
      actionRequired: isActionRequired(record.shared.caseNumber, record.shared.clientName),
      quoUrl: quoUrlForCase(record, stored),
    };
  });

  // Sentiment tab: one row per Quo contact reading (same grain as the weekly reporter).
  const sentimentRows: ClientContactRow[] = [];
  for (const reading of sentimentsByContact.values()) {
    const record = openByCaseNumber.get(cleanCaseNumber(reading.caseNumber));
    if (!record) continue;
    const caseNumber = cleanCaseNumber(record.shared.caseNumber);
    const dates = clientContactDates(summary.get(caseNumber) ?? null, { qualifying: qualifyingRule });
    const stored = summary.get(caseNumber);
    sentimentRows.push({
      caseId: record.shared.id,
      caseNumber: record.shared.caseNumber,
      attorneyId: record.attorney.id,
      clientName: reading.clientName,
      attorneyName: record.attorney.name,
      paralegalName: record.paralegal.name,
      legalAssistantName: record.legalAssistant?.name ?? "",
      lastInteraction: dates.lastInteraction,
      lastAttempt: dates.lastAttempt,
      lastQualifyingCall: stored?.lastQualifyingCallAt ?? null,
      lastQualifyingCallId: stored?.lastQualifyingCallId ?? null,
      lastQualifyingCallSlackUrl: stored?.lastQualifyingCallSlackUrl ?? null,
      lastInboundText: stored?.lastInboundTextAt ?? null,
      lastOutboundText: stored?.lastOutboundTextAt ?? null,
      lastTextExchange: stored?.lastTextExchangeAt ?? null,
      lastOutboundCall: stored?.lastOutboundCallAt ?? null,
      lastOtherAt: stored?.lastOtherAt ?? null,
      lastOtherType: stored?.lastOtherType ?? null,
      lastOtherDetails: stored?.lastOtherDetails ?? null,
      sentiment: reading.sentiment,
      sentimentScore: reading.score,
      sentimentReason: reading.reasonSummary,
      sentimentEvidenceUrls: reading.evidenceUrls,
      sentimentEvidence: reading.evidenceItems,
      sentimentWeekLabel: reading.weekLabel,
      sentimentWindowStart: reading.windowStart,
      sentimentWindowEnd: reading.windowEnd,
      sentimentScoredAt: reading.scoredAt,
      clientPhones: phonesForCase(record),
      actionRequired: isActionRequired(record.shared.caseNumber, reading.clientName),
      quoUrl: quoUrlForCase(record, stored),
    });
  }

  // Include open cases with no contact reading so Unknown / No reading still appears.
  const casesWithReading = new Set(sentimentRows.map((row) => cleanCaseNumber(row.caseNumber)));
  for (const row of rows) {
    if (casesWithReading.has(cleanCaseNumber(row.caseNumber))) continue;
    sentimentRows.push({
      ...row,
      sentiment: null,
      sentimentScore: null,
      sentimentReason: null,
      sentimentEvidenceUrls: [],
      sentimentEvidence: [],
      sentimentWeekLabel: null,
      sentimentWindowStart: null,
      sentimentWindowEnd: null,
      sentimentScoredAt: null,
    });
  }

  const channelIdByCase = new Map<string, string>();
  for (const [caseNumber, channel] of slackChannels) {
    if (channel.slackChannelId) channelIdByCase.set(cleanCaseNumber(caseNumber), channel.slackChannelId);
  }

  // Call 60+sec Slack permalinks are resolved on contact cron and read from cache here.
  // Sentiment evidence links stay a small best-effort page enrichment.
  let sentimentRowsWithSlack = sentimentRows;
  try {
    sentimentRowsWithSlack = await attachSentimentEvidenceSlackLinks(sentimentRows, channelIdByCase, {
      budgetMs: 2500,
      maxChannels: 20,
    });
  } catch (error) {
    console.error("[client-contact] Slack evidence enrichment skipped", error);
  }
  const rowsWithSlack = rows;

  return (
    <Suspense fallback={<div className="text-sm text-muted-foreground">Loading contact…</div>}>
      <ClientContactView
        rows={rowsWithSlack}
        sentimentRows={sentimentRowsWithSlack}
        scoreboardAttorneyIds={settings.contactScoreboardAttorneyIds}
      />
    </Suspense>
  );
}
