import { ClientContactTable } from "@/components/client-contact/client-contact-table";
import { PageHeader } from "@/components/layout/page-header";
import { listClientContactSummaries } from "@/lib/client-contact/repository";
import { CLIENT_CONTACT_WINDOW_DAYS, clientContactDates } from "@/lib/client-contact/types";
import { caseRequiresOngoingUpdates } from "@/lib/case-status";
import { cleanCaseNumber } from "@/lib/csv/parse";
import { loadViewerCaseBundle } from "@/lib/data/viewer-data";

export const dynamic = "force-dynamic";

export default async function ClientContactPage() {
  const { records } = await loadViewerCaseBundle();
  const open = records.filter((record) => caseRequiresOngoingUpdates(record));
  const summary = await listClientContactSummaries(open.map((record) => record.shared.caseNumber));

  const rows = open.map((record) => {
    const dates = clientContactDates(summary.get(cleanCaseNumber(record.shared.caseNumber)) ?? null);
    const stored = summary.get(cleanCaseNumber(record.shared.caseNumber));
    return {
      caseId: record.shared.id,
      caseNumber: record.shared.caseNumber,
      clientName: record.shared.clientName,
      attorneyName: record.attorney.name,
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
