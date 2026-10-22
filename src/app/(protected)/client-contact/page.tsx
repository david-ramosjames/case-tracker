import { ClientContactTable } from "@/components/client-contact/client-contact-table";
import { PageHeader } from "@/components/layout/page-header";
import { buildViewerContext } from "@/lib/auth/access";
import { listClientContactSummaries } from "@/lib/client-contact/repository";
import { CLIENT_CONTACT_WINDOW_DAYS, clientContactDates } from "@/lib/client-contact/types";
import { caseRequiresOngoingUpdates } from "@/lib/case-status";
import { cleanCaseNumber } from "@/lib/csv/parse";
import { loadViewerCaseBundle } from "@/lib/data/viewer-data";
import { type CaseRecord } from "@/lib/types";

export const dynamic = "force-dynamic";

function isAssignedToViewer(record: CaseRecord, contactId: string) {
  return (
    record.shared.attorneyId === contactId ||
    record.shared.paralegalId === contactId ||
    record.shared.legalAssistantId === contactId
  );
}

export default async function ClientContactPage() {
  const { records, sessionUser, users } = await loadViewerCaseBundle();
  const viewer = buildViewerContext(sessionUser, users);
  const open = records.filter((record) => {
    if (record.tracker.caseStage === "Referred") return false;
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
      lastInteraction: dates.lastInteraction,
      lastOutboundCall: stored?.lastOutboundCallAt ?? null,
      lastOutboundText: stored?.lastOutboundTextAt ?? null,
    };
  });

  return (
    <>
      <PageHeader
        eyebrow="Client contact"
        title="Last client contact"
        description={`Open cases that need client contact within ${CLIENT_CONTACT_WINDOW_DAYS} days. Last attempt matches the Contact Summary sheet: latest of last interaction, last outbound call, and last outbound text.`}
      />
      <ClientContactTable rows={rows} />
    </>
  );
}
