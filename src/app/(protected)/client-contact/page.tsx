import { ClientContactTable } from "@/components/client-contact/client-contact-table";
import { PageHeader } from "@/components/layout/page-header";
import { buildViewerContext } from "@/lib/auth/access";
import { listClientContactSummaries } from "@/lib/client-contact/repository";
import { CLIENT_CONTACT_WINDOW_DAYS, clientContactDates } from "@/lib/client-contact/types";
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
  const [{ records, sessionUser, users }, slackChannels] = await Promise.all([
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
  const summary = await listClientContactSummaries(open.map((record) => record.shared.caseNumber));

  const rows = open.map((record) => {
    const dates = clientContactDates(summary.get(cleanCaseNumber(record.shared.caseNumber)) ?? null);
    const stored = summary.get(cleanCaseNumber(record.shared.caseNumber));
    return {
      caseId: record.shared.id,
      caseNumber: record.shared.caseNumber,
      clientName: record.shared.clientName,
      attorneyName: record.attorney.name,
      paralegalName: record.paralegal.name,
      legalAssistantName: record.legalAssistant?.name ?? "",
      lastAttempt: dates.lastAttempt,
      lastOutboundCall: stored?.lastOutboundCallAt ?? null,
      lastOutboundText: stored?.lastOutboundTextAt ?? null,
      lastOtherAt: stored?.lastOtherAt ?? null,
      lastOtherType: stored?.lastOtherType ?? null,
      lastOtherDetails: stored?.lastOtherDetails ?? null,
      quoUrl: quoUrlForCase(record),
    };
  });

  return (
    <>
      <PageHeader
        eyebrow="Client contact"
        title="Last client contact"
        description={`Open cases that need client contact within ${CLIENT_CONTACT_WINDOW_DAYS} days. Last attempt is the latest of a Quo call or text and a manual Slack note such as “phone call - client called about the court date.”`}
      />
      <ClientContactTable rows={rows} />
    </>
  );
}
