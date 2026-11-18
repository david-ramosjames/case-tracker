import { findContactForSession } from "@/lib/auth/access";
import { requireSessionUser } from "@/lib/auth/session";
import { AttorneyView } from "@/components/performance/attorney-view";
import { type ConfirmEventRow } from "@/components/performance/confirm-events-panel";
import { canBrowsePerformancePeople } from "@/lib/performance/access";
import {
  attorneyBoardDateWindow,
  buildAttorneyBoardBuckets,
} from "@/lib/performance/attorney-board";
import { listAttorneyPlanLines } from "@/lib/performance/attorney-plans";
import {
  listCommitmentsForWeek,
  listDeliverablesForPerson,
} from "@/lib/performance/deliverables";
import { buildPersonScorecardBundle } from "@/lib/performance/person-scorecard";
import { filterAttorneys, isAttorneyRole, sortCasesByNumber } from "@/lib/performance/staff-roles";
import { listPerformanceTargets } from "@/lib/performance/targets";
import { shiftWeekStart } from "@/lib/performance/team-rollup";
import { weekStartMondayCt } from "@/lib/performance/weeks";
import { loadViewerCaseBundle } from "@/lib/data/viewer-data";
import {
  getNextScheduledDocketFlowEvents,
  listDocketFlowCaseEventsForCases,
} from "@/lib/supabase/services";
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
  const trendSince = shiftWeekStart(weekStart, -13);
  const canBrowsePeople = canBrowsePerformancePeople(sessionUser.role);

  const attorneys = filterAttorneys(users);
  let selectedAttorney: AppUser | null =
    contact && isAttorneyRole(contact.role) ? contact : attorneys[0] ?? null;
  if (canBrowsePeople && params.person) {
    selectedAttorney = attorneys.find((u) => u.id === params.person) ?? selectedAttorney;
  }

  const [lines, deliverables, commitments, targets] = await Promise.all([
    selectedAttorney
      ? listAttorneyPlanLines({ attorneyContactId: selectedAttorney.id, weekStart })
      : Promise.resolve([]),
    selectedAttorney
      ? listDeliverablesForPerson({
          contactId: selectedAttorney.id,
          asAttorney: true,
          completedSince: trendSince,
        })
      : Promise.resolve([]),
    listCommitmentsForWeek(weekStart),
    listPerformanceTargets(),
  ]);

  const scorecard = selectedAttorney
    ? buildPersonScorecardBundle({
        role: "attorney",
        personId: selectedAttorney.id,
        weekStart,
        lastWeekStart,
        deliverables,
        commitments,
        targets,
      })
    : null;

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

  const attorneyRecords = selectedAttorney
    ? records.filter((r) => r.shared.attorneyId === selectedAttorney.id)
    : [];

  const window = attorneyBoardDateWindow(weekStart, lastWeekStart);
  let eventsByCaseId: Record<string, Awaited<ReturnType<typeof listDocketFlowCaseEventsForCases>>> = {};
  try {
    const events = await listDocketFlowCaseEventsForCases({
      caseIds: attorneyRecords.map((r) => r.shared.id),
      dateFrom: window.dateFrom,
      dateTo: window.dateTo,
    });
    eventsByCaseId = {};
    for (const event of events) {
      const list = eventsByCaseId[event.caseId] ?? [];
      list.push(event);
      eventsByCaseId[event.caseId] = list;
    }
  } catch {
    eventsByCaseId = {};
  }

  const boardBuckets = selectedAttorney
    ? buildAttorneyBoardBuckets({
        weekStart,
        lastWeekStart,
        personId: selectedAttorney.id,
        deliverables,
        commitments,
        records: attorneyRecords,
        eventsByCaseId,
      })
    : null;

  const confirmRows: ConfirmEventRow[] = [];
  if (selectedAttorney) {
    for (const record of attorneyRecords.slice(0, 25)) {
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
      scorecard={scorecard}
      boardBuckets={boardBuckets}
    />
  );
}
