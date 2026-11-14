import { findContactForSession } from "@/lib/auth/access";
import { requireSessionUser } from "@/lib/auth/session";
import { ConfirmEventsPanel, type ConfirmEventRow } from "@/components/performance/confirm-events-panel";
import { MyWorkView } from "@/components/performance/my-work-view";
import { canViewAllParalegalWorkloads } from "@/lib/performance/access";
import {
  listAllOpenDeliverables,
  listCommitmentsForWeek,
  listDeliverablesForAssignee,
} from "@/lib/performance/deliverables";
import { weekStartMondayCt } from "@/lib/performance/weeks";
import { loadViewerCaseBundle } from "@/lib/data/viewer-data";
import { getNextScheduledDocketFlowEvents } from "@/lib/supabase/services";

export const dynamic = "force-dynamic";

export default async function PerformanceMyWorkPage() {
  const sessionUser = await requireSessionUser();
  const { records, users } = await loadViewerCaseBundle();
  const contact = findContactForSession(users, sessionUser);
  const weekStart = weekStartMondayCt();
  const canBrowseAll = canViewAllParalegalWorkloads(sessionUser.role);

  const deliverables = contact
    ? canBrowseAll && sessionUser.role === "attorney"
      ? await listAllOpenDeliverables()
      : await listDeliverablesForAssignee(contact.id)
    : [];
  const commitments = await listCommitmentsForWeek(weekStart);

  const caseOptions = records.slice(0, 400).map((r) => ({
    id: r.shared.id,
    caseNumber: r.shared.caseNumber,
    clientName: r.shared.clientName,
    paralegalId: r.shared.paralegalId,
    attorneyId: r.shared.attorneyId,
  }));

  const confirmRows: ConfirmEventRow[] = [];
  if (sessionUser.role === "attorney" || sessionUser.role === "admin" || sessionUser.role === "manager") {
    const attorneyRecords = contact
      ? records.filter((r) => r.shared.attorneyId === contact.id).slice(0, 25)
      : records.slice(0, 15);
    for (const record of attorneyRecords) {
      try {
        const events = await getNextScheduledDocketFlowEvents(record.shared.id, 2);
        for (const event of events) {
          confirmRows.push({
            caseId: record.shared.id,
            caseNumber: record.shared.caseNumber,
            clientName: record.shared.clientName,
            attorneyUserId: record.shared.attorneyId,
            assigneeUserId: record.shared.paralegalId,
            event,
          });
        }
      } catch {
        // Calendar read is best-effort for confirmation queue.
      }
    }
  }

  return (
    <div className="space-y-6">
      <MyWorkView
        initialDeliverables={deliverables}
        initialCommitments={commitments}
        weekStart={weekStart}
        contactId={contact?.id ?? null}
        canBrowseAll={canBrowseAll}
        caseOptions={caseOptions}
      />
      {confirmRows.length > 0 ? <ConfirmEventsPanel rows={confirmRows} /> : null}
    </div>
  );
}
