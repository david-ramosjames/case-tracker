import { ClientContactView } from "@/components/client-contact/client-contact-table";
import { buildViewerContext } from "@/lib/auth/access";
import { listClientContactSummaries, listLatestClientSentiments } from "@/lib/client-contact/repository";
import { clientContactDates } from "@/lib/client-contact/types";
import { caseRequiresOngoingUpdates } from "@/lib/case-status";
import { cleanCaseNumber } from "@/lib/csv/parse";
import { loadViewerCaseBundle } from "@/lib/data/viewer-data";
import { getQuoClientSmsUrl, getQuoContactUrl } from "@/lib/quo/links";
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

function quoUrlForCase(record: CaseRecord) {
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

export default async function ClientContactPage() {
  const [{ records, sessionUser, users, settings }, slackChannels] = await Promise.all([
    loadViewerCaseBundle(),
    loadSlackChannelMapByCaseNumber(),
  ]);
  const viewer = buildViewerContext(sessionUser, users);
  const open = records.filter((record) => {
    const topicStage = slackChannels.get(cleanCaseNumber(record.shared.caseNumber))?.topicStage;
    if (isReferredCase(record, topicStage)) return false;
    if (!caseRequiresOngoingUpdates(record)) return false;
    if (viewer.isAdmin) return true;
    return viewer.contactId ? isAssignedToViewer(record, viewer.contactId) : false;
  });
  const caseNumbers = open.map((record) => record.shared.caseNumber);
  const [summary, sentiments] = await Promise.all([
    listClientContactSummaries(caseNumbers),
    listLatestClientSentiments(caseNumbers),
  ]);

  const rows = open.map((record) => {
    const caseNumber = cleanCaseNumber(record.shared.caseNumber);
    const dates = clientContactDates(summary.get(caseNumber) ?? null);
    const stored = summary.get(caseNumber);
    const sentiment = sentiments.get(caseNumber);
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
      lastHumanCall: stored?.lastHumanCallAt ?? null,
      lastConversation: stored?.lastConversationAt ?? null,
      lastInboundText: stored?.lastInboundTextAt ?? null,
      lastOutboundCall: stored?.lastOutboundCallAt ?? null,
      lastOutboundText: stored?.lastOutboundTextAt ?? null,
      lastOtherAt: stored?.lastOtherAt ?? null,
      lastOtherType: stored?.lastOtherType ?? null,
      lastOtherDetails: stored?.lastOtherDetails ?? null,
      sentiment: sentiment?.sentiment ?? null,
      sentimentScore: sentiment?.score ?? null,
      sentimentReason: sentiment?.reasonSummary ?? null,
      sentimentWeekLabel: sentiment?.weekLabel ?? null,
      sentimentScoredAt: sentiment?.scoredAt ?? null,
      quoUrl: quoUrlForCase(record),
    };
  });

  return <ClientContactView rows={rows} scoreboardAttorneyIds={settings.contactScoreboardAttorneyIds} />;
}
