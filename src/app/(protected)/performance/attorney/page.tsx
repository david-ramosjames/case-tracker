import { findContactForSession } from "@/lib/auth/access";
import { requireSessionUser } from "@/lib/auth/session";
import { AttorneyView } from "@/components/performance/attorney-view";
import { type ConfirmEventRow } from "@/components/performance/confirm-events-panel";
import { canBrowsePerformancePeople } from "@/lib/performance/access";
import { listAttorneyPlanLines } from "@/lib/performance/attorney-plans";
import {
  listCommitmentsForWeek,
  listDeliverablesForPerson,
} from "@/lib/performance/deliverables";
import { filterAttorneys, isAttorneyRole, sortCasesByNumber } from "@/lib/performance/staff-roles";
import { shiftWeekStart } from "@/lib/performance/team-rollup";
import { weekStartMondayCt } from "@/lib/performance/weeks";
import { loadViewerCaseBundle } from "@/lib/data/viewer-data";
import { getNextScheduledDocketFlowEvents } from "@/lib/supabase/services";
import { type AppUser } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function PerformanceAttorneysPage({
  searchParams,
}: {
  searchParams?: Promise<{ person?: string }>;
}) {
  const sessionUser = await requireSessionUser();
  const params = searchParams ? await searchParams : {};
  const { records, users } = await loadViewerCaseBundle();
  const contact = findContactForSession(users, sessionUser);
  const weekStart = weekStartMondayCt();
  const lastWeekStart = shiftWeekStart(weekStart, -1);
  const canBrowsePeople = canBrowsePerformancePeople(sessionUser.role);

  const attorneys = filterAttorneys(users);
  let selectedAttorney: AppUser | null =
    contact && isAttorneyRole(contact.role) ? contact : attorneys[0] ?? null;
  if (canBrowsePeople && params.person) {
    selectedAttorney = attorneys.find((u) => u.id === params.person) ?? selectedAttorney;
  }

  const [lines, deliverables, commitments] = await Promise.all([
    selectedAttorney
      ? listAttorneyPlanLines({ attorneyContactId: selectedAttorney.id, weekStart })
      : Promise.resolve([]),
    selectedAttorney
      ? listDeliverablesForPerson({
          contactId: selectedAttorney.id,
          asAttorney: true,
          completedSince: lastWeekStart,
        })
      : Promise.resolve([]),
    listCommitmentsForWeek(weekStart),
  ]);

  const caseOptions = sortCasesByNumber(
    records.map((r) => ({
      id: r.shared.id,
      caseNumber: r.shared.caseNumber,
      clientName: r.shared.clientName,
      paralegalId: r.shared.paralegalId,
      attorneyId: r.shared.attorneyId,
    })),
  );

  const nameById = Object.fromEntries(users.map((u) => [u.id, u.name]));

  const confirmRows: ConfirmEventRow[] = [];
  if (selectedAttorney) {
    const attorneyRecords = records.filter((r) => r.shared.attorneyId === selectedAttorney.id).slice(0, 25);
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
    <AttorneyView
      initialDeliverables={deliverables}
      initialCommitments={commitments}
      initialLines={lines}
      weekStart={weekStart}
      lastWeekStart={lastWeekStart}
      selectedAttorney={selectedAttorney}
      attorneys={attorneys}
      canBrowsePeople={canBrowsePeople}
      caseOptions={caseOptions}
      nameById={nameById}
      viewerContactId={contact?.id ?? null}
      confirmRows={confirmRows}
    />
  );
}
